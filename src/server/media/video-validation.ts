import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HttpError } from "@/server/auth";

const execute = promisify(execFile);
interface Probe { format?: { format_name?: string; duration?: string }; streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[] }

/** Inspect only the uploaded local file. No network protocols, shell or transcoding. */
export async function validateVideo(buffer: Buffer, mime: string): Promise<{ width: number; height: number }> {
  const directory = await mkdtemp(path.join(tmpdir(), "iere-video-"));
  const input = path.join(directory, mime === "video/mp4" ? "input.mp4" : "input.webm");
  try {
    await writeFile(input, buffer, { flag: "wx" });
    let probe: Probe;
    try {
      const result = await execute("ffprobe", [
        "-v", "error", "-protocol_whitelist", "file", "-show_entries",
        "format=format_name,duration:stream=codec_type,codec_name,width,height",
        "-of", "json", input,
      ], { timeout: 10000, maxBuffer: 65536, windowsHide: true });
      if (result.stderr.trim()) throw new Error("Invalid container");
      probe = JSON.parse(result.stdout) as Probe;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        throw new HttpError(503, "Video validation is unavailable. Please try again later.", "VIDEO_VALIDATOR_UNAVAILABLE");
      }
      throw new HttpError(400, "This video is malformed or could not be validated.", "INVALID_VIDEO");
    }
    const video = probe.streams?.filter((stream) => stream.codec_type === "video") ?? [];
    const audio = probe.streams?.filter((stream) => stream.codec_type === "audio") ?? [];
    const mp4 = mime === "video/mp4";
    const container = probe.format?.format_name ?? "";
    if (video.length !== 1 || audio.length > 1 || !(mp4 ? container.includes("mp4") : container.includes("webm")) ||
        !(mp4 ? video[0].codec_name === "h264" : ["vp8", "vp9"].includes(video[0].codec_name ?? "")) ||
        audio.some((stream) => !(mp4 ? stream.codec_name === "aac" : ["opus", "vorbis"].includes(stream.codec_name ?? ""))) ||
        probe.streams?.some((stream) => !["video", "audio"].includes(stream.codec_type ?? "")) ||
        !video[0].width || !video[0].height || !Number.isFinite(Number(probe.format?.duration)) || Number(probe.format?.duration) <= 0) {
      throw new HttpError(400, "Use MP4 H.264/AAC or WebM VP8/VP9 with Opus/Vorbis audio.", "UNSUPPORTED_VIDEO");
    }
    return { width: video[0].width, height: video[0].height };
  } finally {
    await unlink(input).catch(() => {});
    await rmdir(directory).catch(() => {});
  }
}

// The Docker test image typechecks before `next build` generates next-env.d.ts.
// Reuse Next's actual static-image declarations instead of permissive custom types.
/// <reference types="next/image-types/global" />

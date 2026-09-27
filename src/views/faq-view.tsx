"use client";

import * as React from "react";
import { Link } from "@/lib/router";
import { api } from "@/lib/api-client";
import { usePageMeta } from "@/components/layout/app-shell";
import { Breadcrumbs, SectionHeading, LoadingState } from "@/components/common";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useRoute } from "@/lib/router";
import { localeOf } from "@/lib/i18n";
import { faqGroupLabel, journeyCopy } from "@/lib/journey-copy";

interface Faq {
  id: string;
  groupKey: string;
  question: string;
  answer: string;
}

export default function FaqView() {
  const locale = localeOf(useRoute().locale);
  const copy = journeyCopy(locale).faq;
  const [faqs, setFaqs] = React.useState<Faq[] | null>(null);

  usePageMeta({
    title: copy.title,
    description: copy.description,
    jsonLd: undefined,
  });

  React.useEffect(() => {
    let active = true;
    setFaqs(null);
    api.get<{ faqs: Faq[] }>(`/api/content/faqs?locale=${locale}`)
      .then((r) => { if (active) setFaqs(r.faqs); })
      .catch(() => { if (active) setFaqs([]); });
    return () => { active = false; };
  }, [locale]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, Faq[]>();
    faqs?.forEach((f) => {
      const list = map.get(f.groupKey) ?? [];
      list.push(f);
      map.set(f.groupKey, list);
    });
    return [...map.entries()];
  }, [faqs]);

  usePageMeta({
    title: copy.title,
    description: copy.description,
    jsonLd: faqs
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }
      : undefined,
  });

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: copy.home, to: "/" }, { label: copy.name }]} />
      <div className="mx-auto mt-4 max-w-3xl">
        <SectionHeading kicker={copy.kicker} title={copy.title} as="h1" description={copy.description} />

        {faqs === null ? (
          <LoadingState rows={3} />
        ) : (
          <div className="mt-8 space-y-8">
            {faqs.length === 0 && <p className="text-muted-foreground">{copy.empty}</p>}
            {grouped.map(([group, items]) => (
              <section key={group} aria-labelledby={`faq-${group}`}>
                <h2 id={`faq-${group}`} className="kicker mb-3">{faqGroupLabel(group, locale)}</h2>
                <Accordion type="single" collapsible className="rounded-xl border border-border/70 bg-card">
                  {items.map((f) => (
                    <AccordionItem key={f.id} value={f.id}>
                      <AccordionTrigger className="px-4 text-start font-medium hover:no-underline">
                        {f.question}
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4 pt-0 text-sm leading-relaxed text-muted-foreground">
                        {f.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </section>
            ))}
          </div>
        )}

        <div className="mt-10 rounded-xl border border-brand/30 bg-brand-faint p-6 text-center">
          <p className="font-display text-lg font-semibold">{copy.question}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{copy.help}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Button asChild><Link to="/advisor">{copy.advisor}</Link></Button>
            <Button asChild variant="outline"><Link to="/consultation">{copy.consultation}</Link></Button>
          </div>
        </div>
      </div>
    </div>
  );
}

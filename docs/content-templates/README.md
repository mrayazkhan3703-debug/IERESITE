# Owner content intake

These templates contain placeholders and are not publishable facts. Supply source files and replace all placeholders before import. Demo drafts are separate from real inventory and approved AI knowledge.

## Inventory

`inventory.template.json` uses the existing canonical JSON-array feed contract. Every row needs a stable `externalId`, title, community name and positive AED price. Provide coordinates, availability, source update time and the listing type when known. Community/project/developer names must match canonical CMS records. Preview import changes before applying them; preserve editorial overrides and source provenance. Rent frequency is completed in the CMS before publishing a rental.

The deferred worker means unattended bulk ingestion is not accepted as operational. Controlled import must use the existing reviewed import pipeline. Publication uses the repaired Property form and its checklist.

## Website Team

`team.template.json` uses the website profile contract. No login account is required. Upload the owner's authorized photo in the Team form, then retain its Media Library ID. Public contact information must be intended for publication. A draft profile does not grant login permissions or Advisor eligibility. This is a preparation template, not a new bulk-import endpoint.

## Editorial content and Advisor knowledge

`content.template.json` follows the content create contract and begins unpublished. Supply an actual HTTPS source, publisher, verification date and review date. Do not put a future verification date in the template. English and Arabic versions need separately reviewed text.

Approved AI knowledge additionally needs source title, publisher, canonical URL, source type, trust tier, verification/freshness dates and the approved document text. Source approval and bounded indexing are separate from content publication. Demo data is never promoted to approved knowledge. Attach the source documents rather than asking the importer to infer facts.

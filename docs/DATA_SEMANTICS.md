# Database temporal and JSON semantics

The canonical database timezone is UTC. Application instants use PostgreSQL
`timestamptz(3)` and cross service boundaries as ISO-8601 strings with an explicit
offset. The migration treats legacy timezone-less values as UTC; it does not
reinterpret them using the machine timezone.

Calendar-only business values use PostgreSQL `date`: project launch/handover,
payment-plan validity, portfolio purchase date, market reporting periods, sale
transaction date, and rent contract date. UI code must not shift these through a
local timezone when formatting them.

Durable operational envelopes use JSONB: CRM outbound payloads, inbound webhook
payloads, outbox events, queued job payloads, and dead-letter payloads. Domain
services normalize these values through `toJsonValue`; readers accept both JSONB
and legacy JSON text during the staged transition.

Remaining `*Json` text fields are legacy presentation/configuration snapshots.
They stay text until their owning service receives an explicit Zod contract and a
non-destructive migration. New operational payload columns must use JSONB and be
validated at the service boundary. A GIN index is added only when a measured query
filters inside a JSON document; none of the current operational queries do so.

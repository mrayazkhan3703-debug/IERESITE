ALTER TABLE public."Agent" ADD COLUMN "ownerOrganizationId" TEXT, ADD COLUMN "publicTeam" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public."Agent" ADD CONSTRAINT "Agent_ownerOrganizationId_fkey" FOREIGN KEY ("ownerOrganizationId") REFERENCES public."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
UPDATE public."Agent" a SET "ownerOrganizationId" = u."organizationId" FROM public."User" u WHERE a."userId" = u.id;
UPDATE public."Agent" a SET "publicTeam" = true WHERE a.active AND a."publicAdvisor" AND (a."userId" IS NULL OR EXISTS (SELECT 1 FROM public."User" u WHERE u.id = a."userId" AND u."isActive" AND u."emailVerified" IS NOT NULL AND EXISTS (SELECT 1 FROM public."UserRole" ur JOIN public."Role" r ON r.id = ur."roleId" WHERE ur."userId" = u.id AND r.key = 'AGENT')));
CREATE INDEX "Agent_ownerOrganizationId_idx" ON public."Agent"("ownerOrganizationId");

-- Document family for a transcript-template layout: TRANSCRIPT | CERTIFICATE.
-- Additive column; existing templates default to TRANSCRIPT.
ALTER TABLE "TranscriptTemplate" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'TRANSCRIPT';

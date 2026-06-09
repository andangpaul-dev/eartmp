/**
 * Institution domain entity — the deploying institution's identity and
 * branding. A singleton (one row). Framework-free.
 */

export type CalendarType = "SEMESTER" | "TRIMESTER" | "QUARTER";

export const CALENDAR_TYPES: readonly CalendarType[] = [
  "SEMESTER",
  "TRIMESTER",
  "QUARTER",
];

export interface Institution {
  id: string;
  name: string;
  motto?: string;
  accreditationNo?: string;
  address?: string;
  telephone?: string;
  email?: string;
  website?: string;
  logoPath?: string;
  sealPath?: string;
  registrarSignPath?: string;
  calendarType: CalendarType;
  transcriptNumberRule?: string;
}

export const InstitutionRules = {
  isValidCalendarType(value: string): value is CalendarType {
    return (CALENDAR_TYPES as readonly string[]).includes(value);
  },
};

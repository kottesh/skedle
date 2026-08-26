// Shared, normalized API contracts used by both the Worker and the browser client.

export type Kind = "theory" | "lab" | "activity";
export type AttendanceStatus = "present" | "absent" | "on-duty" | "unmarked" | "mixed";

export interface BellPeriod {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface ScheduleBreak {
  label: string;
  start: string;
  end: string;
}

export interface AttendancePart {
  hour: number;
  status: Exclude<AttendanceStatus, "mixed">;
  markedBy?: string;
  markedSubject?: string;
}

export interface Attendance {
  status: AttendanceStatus;
  markedBy: string[];
  markedSubject: string[];
  parts: AttendancePart[];
}

export interface Session {
  hourStart: number;
  hourEnd: number;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  title: string;
  code: string;
  short: string;
  kind: Kind;
  staff: string[];
  section?: string;
  attendance: Attendance;
}

export interface StudentSummary {
  course?: string;
  degree?: string;
  semester?: number;
  section?: string;
}

export interface HolidayPayload {
  name: string;
  type?: string;
  date?: string;
}

export interface DayPayload {
  date: string;
  dayOrder: number | null;
  sessions: Session[];
  bell: Record<number, BellPeriod>;
  breaks: ScheduleBreak[];
  student?: StudentSummary;
  holiday?: HolidayPayload;
}

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "UPSTREAM_UNAVAILABLE"
  | "INVALID_DATE"
  | "INVALID_LOGIN"
  | "NOT_FOUND"
  | "BAD_REQUEST";

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export interface LoginResponse {
  token: string;
  name: string;
}

export function buildCsvTemplateText(headers: string[]): string {
  const cell = (h: string) =>
    /[",\n]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h;
  return headers.map(cell).join(",") + "\n";
}
export function downloadCsvTemplate(filename: string, headers: string[]): void {
  const blob = new Blob([buildCsvTemplateText(headers)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
export const COURSE_TEMPLATE_HEADERS = [
  "Course code",
  "Course title",
  "Credit Value",
  "Course type",
];
export const STUDENT_TEMPLATE_HEADERS = [
  "matricNumber",
  "fullName",
  "regNumber",
  "gender",
  "nationality",
];

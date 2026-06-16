// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { RecordsScreen } from "../../src/presentation/screens/RecordsScreen";
import type { TranscriptRecord } from "../../src/presentation/runtime/contract";
import { renderScreen } from "./harness";

const rec = (over: Partial<TranscriptRecord> = {}): TranscriptRecord => ({
  id: "t1",
  transcriptNumber: "TR-2026-000001",
  studentId: "s1",
  matricNumber: "M/1",
  studentName: "Ada Lovelace",
  type: "ACADEMIC_TRANSCRIPT",
  status: "LOCKED",
  generatedAt: "2026-01-02T00:00:00.000Z",
  ...over,
});

describe("RecordsScreen", () => {
  it("lists treated transcripts with student identity and status", async () => {
    renderScreen(<RecordsScreen />, {
      permissions: ["transcripts.read"],
      core: { listTranscriptRecords: async () => [rec()] },
    });
    expect(await screen.findByText("TR-2026-000001")).toBeInTheDocument();
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
    // "LOCKED" also appears as a filter <option>; assert the status badge.
    expect(
      screen.getByText("LOCKED", { selector: ".badge" }),
    ).toBeInTheDocument();
  });

  it("passes the status filter to the core query", async () => {
    const listTranscriptRecords = vi.fn(async () => [] as TranscriptRecord[]);
    const { user } = renderScreen(<RecordsScreen />, {
      permissions: ["transcripts.read"],
      core: { listTranscriptRecords },
    });
    await waitFor(() => expect(listTranscriptRecords).toHaveBeenCalled());
    await user.selectOptions(
      screen.getByLabelText(/status filter/i),
      "REVOKED",
    );
    await waitFor(() =>
      expect(listTranscriptRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "REVOKED" }),
      ),
    );
  });

  it("shows an empty state when there are no records", async () => {
    renderScreen(<RecordsScreen />, {
      permissions: ["transcripts.read"],
      core: { listTranscriptRecords: async () => [] },
    });
    expect(await screen.findByText(/no transcripts yet/i)).toBeInTheDocument();
  });
});

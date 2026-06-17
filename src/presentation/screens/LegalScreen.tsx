/**
 * Legal — in-app Terms & Conditions, Disclaimer, and User Policies. Static,
 * offline content from `legal/legalContent.ts` (mirrored under docs/legal/).
 * Available to every signed-in user (no permission gate). A line beginning with
 * "- " renders as a bullet; everything else is a paragraph.
 */
import { useState, type ReactElement } from "react";
import { Card, Button } from "../components/ui";
import { LEGAL_DOCS, type LegalDoc } from "./legal/legalContent";

function Body({ lines }: { lines: string[] }) {
  const out: ReactElement[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length) {
      out.push(
        <ul className="legal-list" key={key}>
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  lines.forEach((line, i) => {
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
    } else {
      flush(`ul-${i}`);
      out.push(<p key={`p-${i}`}>{line}</p>);
    }
  });
  flush("ul-end");
  return <>{out}</>;
}

function DocView({ doc }: { doc: LegalDoc }) {
  const updated = new Date(doc.updated).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <Card title={doc.title}>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Version {__APP_VERSION__} · Last updated {updated}
      </div>
      <p style={{ marginTop: 0 }}>{doc.intro}</p>
      {doc.sections.map((s) => (
        <section key={s.heading} style={{ marginTop: 14 }}>
          <h4 style={{ margin: "0 0 6px" }}>{s.heading}</h4>
          <Body lines={s.body} />
        </section>
      ))}
    </Card>
  );
}

export function LegalScreen() {
  const [active, setActive] = useState<LegalDoc["id"]>("terms");
  const doc = LEGAL_DOCS.find((d) => d.id === active) ?? LEGAL_DOCS[0];
  if (!doc) return null;

  return (
    <div className="stack">
      <div className="row" style={{ gap: 8 }}>
        {LEGAL_DOCS.map((d) => (
          <Button
            key={d.id}
            variant={d.id === active ? "primary" : "default"}
            onClick={() => setActive(d.id)}
          >
            {d.tab}
          </Button>
        ))}
      </div>
      <DocView doc={doc} />
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
        These are default templates provided with the Software. Your institution
        should review and adapt them to its own policies and applicable law;
        they do not constitute legal advice.
      </div>
    </div>
  );
}

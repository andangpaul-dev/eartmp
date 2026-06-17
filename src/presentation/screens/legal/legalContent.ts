/**
 * Legal content (single source of truth) — rendered in-app by LegalScreen and
 * mirrored as markdown under docs/legal/. Static, offline, jurisdiction-neutral
 * defaults: an institution should review and adapt them to local policy and law.
 *
 * A line beginning with "- " renders as a bullet; everything else is a paragraph.
 */
export interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalDoc {
  id: "terms" | "disclaimer" | "policies";
  title: string;
  tab: string;
  updated: string; // ISO date
  intro: string;
  sections: LegalSection[];
}

const UPDATED = "2026-06-17";

export const LEGAL_DOCS: LegalDoc[] = [
  {
    id: "terms",
    title: "Terms & Conditions of Use",
    tab: "Terms & Conditions",
    updated: UPDATED,
    intro:
      "These Terms govern your use of the EduCore Academic Records & Transcript " +
      "Management Platform (EARTMP, “the Software”) deployed by your institution " +
      "(“the Institution”). By accessing or using the Software you agree to be " +
      "bound by these Terms. If you do not agree, do not use the Software.",
    sections: [
      {
        heading: "1. Licence and permitted use",
        body: [
          "The Software is licensed, not sold, to the Institution for the internal " +
            "administration of academic records, results processing, and transcript " +
            "generation. Your right to use it is non-transferable and limited to the " +
            "scope granted by the Institution.",
          "- Use the Software only for legitimate academic-administration purposes.",
          "- Do not copy, redistribute, sublicense, or reverse-engineer the Software " +
            "except as permitted by law.",
        ],
      },
      {
        heading: "2. Accounts and authorisation",
        body: [
          "Access is controlled by individual accounts and role-based permissions. " +
            "You are responsible for all activity performed under your account.",
          "- Keep your credentials and any signing passphrase confidential.",
          "- Do not share accounts or attempt to access functions beyond your role.",
          "- Report any suspected compromise to the Institution immediately.",
        ],
      },
      {
        heading: "3. Authority of records and transcripts",
        body: [
          "A generated transcript is an OFFICIAL issue only once it has been approved " +
            "(or locked) and cryptographically signed. Drafts, previews, and unsigned " +
            "documents are working copies and carry no official standing.",
          "A transcript marked as revoked, or whose signature fails verification, must " +
            "not be relied upon as authentic.",
        ],
      },
      {
        heading: "4. Acceptable use",
        body: [
          "You agree not to misuse the Software, including but not limited to tampering " +
            "with records, signatures, or the audit trail; circumventing access " +
            "controls; or processing data you are not authorised to handle. Your use is " +
            "also subject to the User Policies provided with the Software.",
        ],
      },
      {
        heading: "5. Data, backups, and availability",
        body: [
          "The Software is offline-first and stores data locally on the Institution's " +
            "device. The Institution is responsible for backups, device security, and " +
            "safe custody of encryption passphrases and key material.",
          "- An encrypted database cannot be recovered without its passphrase and its " +
            "accompanying salt file; back them up together and store them securely.",
        ],
      },
      {
        heading: "6. Intellectual property",
        body: [
          "All rights, title, and interest in the Software, excluding the Institution's " +
            "own data, remain with its authors and licensors. Institution logos, seals, " +
            "and content uploaded for branding remain the property of the Institution.",
        ],
      },
      {
        heading: "7. Suspension and termination",
        body: [
          "The Institution may suspend or revoke your access at any time. Provisions " +
            "concerning records authority, intellectual property, and limitation of " +
            "liability survive termination.",
        ],
      },
      {
        heading: "8. Changes and governing law",
        body: [
          "These Terms may be updated; continued use after a change constitutes " +
            "acceptance. These Terms are governed by the laws of the jurisdiction in " +
            "which the Institution operates, unless the Institution specifies otherwise.",
        ],
      },
    ],
  },
  {
    id: "disclaimer",
    title: "Disclaimer",
    tab: "Disclaimer",
    updated: UPDATED,
    intro:
      "Please read this Disclaimer carefully. It limits the warranties and liability " +
      "associated with the Software.",
    sections: [
      {
        heading: "Provided “as is”",
        body: [
          "The Software is provided on an “as is” and “as available” basis without " +
            "warranties of any kind, whether express or implied, including but not " +
            "limited to merchantability, fitness for a particular purpose, and " +
            "non-infringement.",
        ],
      },
      {
        heading: "Accuracy of records",
        body: [
          "The Software is a tool that processes the data entered into it. Responsibility " +
            "for the accuracy, completeness, and lawful processing of student records, " +
            "results, and transcripts rests with the Institution and its authorised users.",
          "- Grading systems, transcript layouts, and institution data are " +
            "runtime-configured; verify configuration before issuing official documents.",
        ],
      },
      {
        heading: "Transcript verification",
        body: [
          "Transcript authenticity is established by its cryptographic signature and " +
            "verification code (QR). A verification result reflects the signing key in " +
            "effect; replacing or rotating a key may affect how previously issued " +
            "transcripts verify. Always confirm a document's status and signature before " +
            "relying on it.",
        ],
      },
      {
        heading: "Data loss",
        body: [
          "To the maximum extent permitted by law, the authors and licensors are not " +
            "liable for loss of data. In particular, an encrypted database is " +
            "UNRECOVERABLE without its passphrase and its sibling salt file. Maintain " +
            "secure, tested backups.",
        ],
      },
      {
        heading: "Limitation of liability",
        body: [
          "To the maximum extent permitted by law, in no event shall the authors or " +
            "licensors be liable for any indirect, incidental, special, consequential, " +
            "or punitive damages, or any loss of data, revenue, or goodwill, arising " +
            "from the use of or inability to use the Software.",
        ],
      },
      {
        heading: "Not professional advice",
        body: [
          "Nothing in the Software constitutes legal, academic, or professional advice.",
        ],
      },
    ],
  },
  {
    id: "policies",
    title: "User Policies",
    tab: "User Policies",
    updated: UPDATED,
    intro:
      "These policies set out how authorised users must operate the Software to protect " +
      "student data and the integrity of academic records.",
    sections: [
      {
        heading: "Account and key security",
        body: [
          "- Use a strong, unique password and never share it.",
          "- Protect the transcript signing passphrase; a lost passphrase cannot be " +
            "recovered and prevents issuing signed transcripts.",
          "- Lock or sign out of the application when leaving the device unattended.",
        ],
      },
      {
        heading: "Confidentiality and data protection",
        body: [
          "Student records are confidential. Access and process them only on a " +
            "need-to-know basis and only for authorised academic administration.",
          "- Do not export, copy, or share records except as your role and the " +
            "Institution's policy permit.",
          "- Apply data minimisation: collect and retain only what is necessary.",
        ],
      },
      {
        heading: "Integrity and acceptable use",
        body: [
          "- Do not falsify records, results, or transcripts.",
          "- Do not attempt to bypass permissions or alter the audit trail.",
          "- Issue official transcripts only after the proper approval workflow.",
        ],
      },
      {
        heading: "Accountability and audit",
        body: [
          "Actions are recorded in an append-only, tamper-evident audit trail. By using " +
            "the Software you acknowledge that your activity may be logged and reviewed " +
            "for security and compliance.",
        ],
      },
      {
        heading: "Backups and continuity",
        body: [
          "- Back up the encrypted database together with its salt file, and store " +
            "backups securely and separately from the device.",
          "- Test restores periodically so backups are known to be usable.",
        ],
      },
      {
        heading: "Signing-key management",
        body: [
          "- Provision and rotate signing keys following the Institution's procedure.",
          "- Replacing (rather than rotating) a signing key invalidates the signatures " +
            "on transcripts issued under the old key — do so only when necessary.",
          "- Where institutions sign independently, manage each institution's key within " +
            "its own scope.",
        ],
      },
      {
        heading: "Incident reporting",
        body: [
          "Report suspected data breaches, lost devices, or compromised credentials to " +
            "the Institution's administrator without delay.",
        ],
      },
    ],
  },
];

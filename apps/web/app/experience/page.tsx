import Image from "next/image";
import { PROFILE } from "../../content/profile";
import { RoleBullets } from "../../components/RoleBullets";

export const metadata = {
  title: "Experience · Eashan Kadam",
  description: PROFILE.intro,
};

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 20,
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const cardHeading: React.CSSProperties = { margin: 0, fontSize: 12, fontWeight: 500, color: "var(--muted)" };

export default function ExperiencePage() {
  return (
    <main style={{ padding: "0 24px 72px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 40, paddingTop: 40 }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 760 }}>
            <h1 style={{ margin: 0, fontSize: 72, fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 0.95 }}>
              Experience
            </h1>
            <p style={{ margin: 0, fontSize: 19, lineHeight: 1.55, color: "var(--body)" }}>{PROFILE.intro}</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <Image
              src="/eashan-headshot.jpg"
              alt=""
              width={64}
              height={64}
              style={{ borderRadius: "50%", objectFit: "cover" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 14, color: "var(--body)" }}>
              <span style={{ fontWeight: 600, color: "var(--ink)" }}>{PROFILE.name}</span>
              <span>{PROFILE.location}</span>
            </div>
            {PROFILE.resumePdf && (
              <a
                href={PROFILE.resumePdf}
                download
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: 44,
                  padding: "0 18px",
                  borderRadius: 999,
                  background: "var(--ink)",
                  color: "var(--bg)",
                  textDecoration: "none",
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                Résumé PDF ↓
              </a>
            )}
          </div>
        </header>

        <section aria-label="Roles" style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--strong)" }}>
          {PROFILE.roles.map((r) => (
            <article
              key={r.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "16px 40px",
                padding: "28px 0",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                  {r.dates}
                </span>
                <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>{r.company}</span>
                {r.metric && (
                  <span
                    className="mono"
                    style={{
                      alignSelf: "flex-start",
                      fontSize: 12,
                      color: "var(--accent)",
                      border: "1px solid var(--accent-line)",
                      background: "var(--accent-soft)",
                      borderRadius: 999,
                      padding: "4px 10px",
                    }}
                  >
                    {r.metric}
                  </span>
                )}
              </div>
              <div style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{r.title}</h2>
                <RoleBullets bullets={r.bullets} />
              </div>
            </article>
          ))}
        </section>

        <section
          aria-label="Education, skills and achievements"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}
        >
          <div style={cardStyle}>
            <h2 className="mono" style={cardHeading}>
              EDUCATION
            </h2>
            {PROFILE.education.map((e) => (
              <div key={e.school} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{e.school}</span>
                <span style={{ fontSize: 14, color: "var(--body)" }}>{e.detail}</span>
              </div>
            ))}
          </div>
          <div style={cardStyle}>
            <h2 className="mono" style={cardHeading}>
              ACHIEVEMENTS
            </h2>
            {PROFILE.achievements.map((a) => (
              <p key={a} style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--body)" }}>
                {a}
              </p>
            ))}
          </div>
          <div style={cardStyle}>
            <h2 className="mono" style={cardHeading}>
              SKILLS
            </h2>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PROFILE.skills.map((s) => (
                <li key={s} style={{ fontSize: 13, border: "1px solid var(--line)", borderRadius: 999, padding: "6px 10px" }}>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}

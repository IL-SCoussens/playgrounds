import fs from "fs";
import path from "path";
import Link from "next/link";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import styles from "./page.module.css";
import AuthBar from "./AuthBar";

interface Tag {
  label: string;
  color: string;
}

interface FileEntry {
  src: string;
  dest: string;
  title: string;
  description: string;
  icon: string;
  icon_color: string;
  tags: Tag[];
}

interface Source {
  repo: string;
  branches: string[];
  files: FileEntry[];
}

interface SourcesConfig {
  sources: Source[];
}

function getPlaygrounds() {
  const sourcesPath = path.join(process.cwd(), "sources.json");
  const config: SourcesConfig = JSON.parse(fs.readFileSync(sourcesPath, "utf-8"));
  const docsDir = path.join(process.cwd(), "docs");

  const playgrounds: (FileEntry & { slug: string; branch?: string })[] = [];

  for (const source of config.sources) {
    for (const file of source.files) {
      const branches = source.branches;
      for (const branch of branches) {
        const filename =
          branches.length > 1
            ? file.dest.replace(".html", `-${branch}.html`)
            : file.dest;
        const filePath = path.join(docsDir, filename);
        if (fs.existsSync(filePath)) {
          playgrounds.push({
            ...file,
            slug: filename.replace(".html", ""),
            branch: branches.length > 1 ? branch : undefined,
          });
        }
      }
    }
  }

  return playgrounds;
}

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return null;
  return verifyToken(token);
}

export default async function Home() {
  const playgrounds = getPlaygrounds();
  const session = await getSession();

  return (
    <main className={styles.main}>
      <AuthBar username={session?.username} role={session?.role} />
      <header className={styles.header}>
        <h1 className={styles.title}>Intellilake Playgrounds</h1>
        <p className={styles.subtitle}>
          Interactive explorers for the Intellilake platform
        </p>
      </header>
      <div className={styles.grid}>
        {playgrounds.map((pg) => (
          <Link
            key={pg.slug}
            href={`/playground/${pg.slug}`}
            className={styles.card}
          >
            <div
              className={styles.icon}
              data-color={pg.icon_color}
            >
              {pg.icon}
            </div>
            <h2 className={styles.cardTitle}>
              {pg.title}
              {pg.branch && (
                <span className={styles.branch}>{pg.branch}</span>
              )}
            </h2>
            <p className={styles.cardDescription}>{pg.description}</p>
            <div className={styles.tags}>
              {pg.tags.map((tag) => (
                <span
                  key={tag.label}
                  className={styles.tag}
                  data-color={tag.color}
                >
                  {tag.label}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

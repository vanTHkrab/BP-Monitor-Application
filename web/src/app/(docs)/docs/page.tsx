import Link from "next/link";

import { getSections } from "@/lib/docs";

export default function DocsIndexPage() {
    const sections = getSections();
    const total = sections.reduce((n, section) => n + section.docs.length, 0);

    return (
        <div>
            <header className="mb-10 border-b pb-6">
                <h1 className="text-3xl font-semibold tracking-tight text-balance">
                    BP Monitor documentation
                </h1>
                <p className="text-muted-foreground mt-2 text-base text-pretty">
                    An end-to-end blood-pressure monitoring platform: patients
                    log readings on mobile, an API gateway persists them, and an
                    AI service reads the numbers off a photo of the monitor.
                </p>
                <p className="text-muted-foreground mt-4 text-sm">
                    {total} documents, rendered from{" "}
                    <code className="font-mono">docs/</code> in the repository.
                    This site holds no copy of its own — edit the Markdown and
                    the page follows.
                </p>
            </header>

            <div className="grid gap-8 sm:grid-cols-2">
                {sections.map((section) => (
                    <section key={section.id}>
                        <h2 className="text-sm font-semibold tracking-wide uppercase">
                            {section.title}
                        </h2>
                        <ul className="mt-3 space-y-3">
                            {section.docs.map((doc) => (
                                <li key={doc.slug.join("/")}>
                                    <Link
                                        href={`/docs/${doc.slug.join("/")}`}
                                        className="group block"
                                    >
                                        <span className="group-hover:text-primary font-medium underline-offset-4 group-hover:underline">
                                            {doc.meta.title}
                                        </span>
                                        <span className="text-muted-foreground mt-0.5 block text-sm text-pretty">
                                            {doc.meta.description}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}

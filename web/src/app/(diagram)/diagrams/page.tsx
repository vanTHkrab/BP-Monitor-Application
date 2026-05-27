import Link from "next/link";

import { DIAGRAM_SECTIONS } from "@/components/diagram-nav";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function DiagramsLandingPage() {
    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
            <header className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Documentation</Badge>
                    <Badge variant="secondary">Mermaid</Badge>
                    <Badge variant="secondary">Live</Badge>
                </div>
                <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                    BP Monitor — Architecture Diagrams
                </h1>
                <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
                    A presentation-ready set of system diagrams covering the
                    Expo mobile app, the Next.js web dashboard, the NestJS API
                    gateway, and the FastAPI AI service. Pick any topic from
                    the sidebar; each page explains what the diagram shows,
                    the trade-offs we made, and what to watch when the system
                    changes.
                </p>
            </header>

            <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold tracking-tight">
                    Audience
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                    Designed for project managers, senior engineers,
                    stakeholders, and new contributors who need to understand
                    the platform without reading the code. Every diagram is
                    rendered from text so it stays in sync with the repo.
                </p>
            </section>

            <section className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold tracking-tight">
                    Diagram catalogue
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                    {DIAGRAM_SECTIONS.flatMap((section) =>
                        section.items
                            .filter((item) => item.url !== "/diagrams")
                            .map((item) => (
                                <Link key={item.url} href={item.url}>
                                    <Card className="h-full transition-colors hover:bg-muted/40">
                                        <CardHeader>
                                            <div className="flex items-center gap-2">
                                                <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-4">
                                                    {item.icon}
                                                </span>
                                                <CardTitle className="text-base">
                                                    {item.title}
                                                </CardTitle>
                                            </div>
                                            <Badge
                                                variant="outline"
                                                className="w-fit text-[10px]"
                                            >
                                                {section.label}
                                            </Badge>
                                        </CardHeader>
                                        <CardContent>
                                            <CardDescription>
                                                {item.summary}
                                            </CardDescription>
                                        </CardContent>
                                    </Card>
                                </Link>
                            )),
                    )}
                </div>
            </section>

            <section className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 md:p-6">
                <h2 className="text-base font-semibold">How to use this</h2>
                <ul className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
                    <li>
                        • Sidebar groups diagrams by intent — Sequence, State,
                        Data &amp; Actors, Flows.
                    </li>
                    <li>
                        • Each page opens with what the diagram shows and why
                        it matters, then renders the diagram itself, then
                        calls out key insights and design trade-offs.
                    </li>
                    <li>
                        • Mermaid renders client-side, picks up light / dark
                        from <code>html.dark</code>, and stays selectable for
                        copy-paste into slide decks.
                    </li>
                </ul>
            </section>
        </div>
    );
}

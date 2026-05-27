"use client";

import * as React from "react";
import { MaximizeIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import {
    TransformComponent,
    TransformWrapper,
    useControls,
} from "react-zoom-pan-pinch";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MermaidProps {
    chart: string;
    className?: string;
    caption?: string;
}

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
    if (!mermaidPromise) {
        mermaidPromise = import("mermaid").then((mod) => mod.default);
    }
    return mermaidPromise;
}

function readIsDark() {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("dark");
}

function ZoomControls() {
    const { zoomIn, zoomOut, resetTransform, centerView } = useControls();
    return (
        <div className="absolute right-2 top-2 z-10 flex flex-col gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm">
            <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => zoomIn()}
                aria-label="Zoom in"
                title="Zoom in"
            >
                <PlusIcon className="size-4" />
            </Button>
            <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => zoomOut()}
                aria-label="Zoom out"
                title="Zoom out"
            >
                <MinusIcon className="size-4" />
            </Button>
            <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => centerView(1)}
                aria-label="Fit to view"
                title="Fit to view"
            >
                <MaximizeIcon className="size-4" />
            </Button>
            <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => resetTransform()}
                aria-label="Reset"
                title="Reset"
            >
                <RotateCcwIcon className="size-4" />
            </Button>
        </div>
    );
}

export function Mermaid({ chart, className, caption }: MermaidProps) {
    const [svg, setSvg] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [isDark, setIsDark] = React.useState<boolean>(false);
    const reactId = React.useId();
    const safeId = `mmd-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

    React.useEffect(() => {
        setIsDark(readIsDark());
        const observer = new MutationObserver(() => setIsDark(readIsDark()));
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class"],
        });
        return () => observer.disconnect();
    }, []);

    React.useEffect(() => {
        let cancelled = false;
        setError(null);

        loadMermaid()
            .then(async (mermaid) => {
                mermaid.initialize({
                    startOnLoad: false,
                    theme: isDark ? "dark" : "default",
                    securityLevel: "loose",
                    fontFamily: "var(--font-sans), ui-sans-serif, system-ui",
                    flowchart: { htmlLabels: true, curve: "basis" },
                    sequence: { useMaxWidth: true, showSequenceNumbers: false },
                    er: { useMaxWidth: true },
                    themeVariables: isDark
                        ? {
                              primaryColor: "#1f2937",
                              primaryTextColor: "#f9fafb",
                              primaryBorderColor: "#4b5563",
                              lineColor: "#9ca3af",
                              secondaryColor: "#374151",
                              tertiaryColor: "#111827",
                          }
                        : {
                              primaryColor: "#f3f4f6",
                              primaryTextColor: "#111827",
                              primaryBorderColor: "#9ca3af",
                              lineColor: "#4b5563",
                              secondaryColor: "#e5e7eb",
                              tertiaryColor: "#ffffff",
                          },
                });
                const { svg } = await mermaid.render(
                    `${safeId}-${isDark ? "d" : "l"}`,
                    chart,
                );
                if (!cancelled) setSvg(svg);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : String(err);
                setError(message);
            });

        return () => {
            cancelled = true;
        };
    }, [chart, isDark, safeId]);

    if (error) {
        return (
            <div
                className={cn(
                    "rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive",
                    className,
                )}
            >
                <div className="font-medium">Diagram failed to render</div>
                <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap">
                    {error}
                </pre>
            </div>
        );
    }

    return (
        <figure
            className={cn(
                "flex flex-col items-stretch gap-3 rounded-lg border bg-card p-4 md:p-6",
                className,
            )}
        >
            <div className="relative h-[480px] w-full overflow-hidden rounded-md border bg-background md:h-[560px]">
                {svg === null ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Rendering diagram…
                    </div>
                ) : (
                    <TransformWrapper
                        minScale={0.1}
                        maxScale={8}
                        initialScale={2.5}
                        centerOnInit
                        wheel={{ step: 0.1 }}
                        doubleClick={{ mode: "reset" }}
                        limitToBounds={false}
                    >
                        <ZoomControls />
                        <TransformComponent
                            wrapperClass="!h-full !w-full cursor-grab active:cursor-grabbing"
                            contentClass="!h-full !w-full flex items-center justify-center [&_svg]:max-h-full [&_svg]:max-w-full [&_svg]:h-auto"
                        >
                            <div
                                className="mermaid-svg flex items-center justify-center p-4"
                                aria-busy={false}
                                dangerouslySetInnerHTML={{ __html: svg }}
                            />
                        </TransformComponent>
                    </TransformWrapper>
                )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                    Drag to pan · scroll to zoom · double-click to reset
                </span>
                {caption ? (
                    <figcaption className="text-right">{caption}</figcaption>
                ) : null}
            </div>
        </figure>
    );
}

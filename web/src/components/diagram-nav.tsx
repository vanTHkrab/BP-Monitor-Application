import * as React from "react";
import {
    BoxIcon,
    CameraIcon,
    DatabaseIcon,
    KeyRoundIcon,
    LayersIcon,
    NetworkIcon,
    RefreshCwIcon,
    ScanIcon,
    UsersIcon,
    WorkflowIcon,
} from "lucide-react";

export interface DiagramNavItem {
    title: string;
    url: string;
    icon: React.ReactNode;
    summary: string;
}

export interface DiagramNavSection {
    label: string;
    items: DiagramNavItem[];
}

export const DIAGRAM_SECTIONS: DiagramNavSection[] = [
    {
        label: "Overview",
        items: [
            {
                title: "Introduction",
                url: "/diagrams",
                icon: <LayersIcon />,
                summary: "Index of every diagram and what it shows.",
            },
            {
                title: "System Architecture",
                url: "/diagrams/architecture",
                icon: <NetworkIcon />,
                summary:
                    "Mobile, web, gateway, AI service, Postgres, Redis, S3 at a glance.",
            },
        ],
    },
    {
        label: "Sequence",
        items: [
            {
                title: "BP Capture Flow",
                url: "/diagrams/sequence/bp-capture",
                icon: <CameraIcon />,
                summary:
                    "On-device YOLO → presign → upload → analyze → poll → save.",
            },
            {
                title: "Auth & 401 Fan-out",
                url: "/diagrams/sequence/auth",
                icon: <KeyRoundIcon />,
                summary: "Token bootstrap and global session-expired handling.",
            },
        ],
    },
    {
        label: "State",
        items: [
            {
                title: "Reading Lifecycle",
                url: "/diagrams/state/reading-lifecycle",
                icon: <RefreshCwIcon />,
                summary:
                    "pending / pending-image / synced — offline-first reading states.",
            },
            {
                title: "Camera Analysis",
                url: "/diagrams/state/camera",
                icon: <ScanIcon />,
                summary: "Camera screen state machine from capture to save.",
            },
        ],
    },
    {
        label: "Data & Actors",
        items: [
            {
                title: "ER Diagram",
                url: "/diagrams/er",
                icon: <DatabaseIcon />,
                summary: "Prisma schema: users, readings, posts, caregivers.",
            },
            {
                title: "Use Cases",
                url: "/diagrams/use-case",
                icon: <UsersIcon />,
                summary: "Patient, clinician, caregiver, ops — what each can do.",
            },
        ],
    },
    {
        label: "Flows",
        items: [
            {
                title: "Offline Sync",
                url: "/diagrams/flow/offline-sync",
                icon: <WorkflowIcon />,
                summary:
                    "SQLite mirror, sync mutex, optimistic UI reconciliation.",
            },
            {
                title: "YOLO Pre-flight",
                url: "/diagrams/flow/yolo-preflight",
                icon: <BoxIcon />,
                summary:
                    "Shared model, on-device gate, warn-not-block fallback.",
            },
        ],
    },
];

export const DIAGRAM_ROUTE_LABELS: Record<string, string> =
    DIAGRAM_SECTIONS.reduce<Record<string, string>>((acc, section) => {
        for (const item of section.items) acc[item.url] = item.title;
        return acc;
    }, {});

'use client'
'use no memo'

import {
    QueryClient,
    QueryClientProvider,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query"
import {
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    useReactTable,
    type ColumnDef,
    type ColumnFiltersState,
    type RowSelectionState,
    type SortingState,
} from "@tanstack/react-table"
import {
    AlertCircle,
    ArrowUpDownIcon,
    CheckCircle2,
    Clock3Icon,
    CopyIcon,
    DatabaseIcon,
    ExternalLinkIcon,
    HardDriveIcon,
    Loader2,
    MoreHorizontalIcon,
    RefreshCwIcon,
    SearchIcon,
    Trash2Icon,
    UploadCloudIcon,
    XCircle,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
    createUploadUrl,
    deleteFilesFromS3,
    getConnection,
    getFileUrl,
    listFiles,
    type S3File,
} from "@/actions/s3-action"
import { AppSidebar } from "@/components/app-sidebar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

type UploadStatus = "queued" | "uploading" | "success" | "error"

interface UploadQueueItem {
  id: string
  file: File
  progress: number
  status: UploadStatus
  message?: string
  key?: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"

  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function uploadObjectViaPresignedUrl({
  file,
  url,
  contentType,
  onProgress,
}: {
  file: File
  url: string
  contentType: string
  onProgress: (progress: number) => void
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()

    request.open("PUT", url)
    request.setRequestHeader("Content-Type", contentType)

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return
      }

      onProgress(Math.round((event.loaded / event.total) * 100))
    }

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100)
        resolve()
        return
      }

      reject(new Error(`Upload failed with status ${request.status}.`))
    }

    request.onerror = () => {
      reject(new Error("Network error while uploading file."))
    }

    request.send(file)
  })
}

function S3DashboardContent() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [prefixDraft, setPrefixDraft] = useState("")
  const [prefix, setPrefix] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageTokens, setPageTokens] = useState<Array<string | undefined>>([undefined])

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([{ id: "lastModified", desc: true }])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [uploadPrefix, setUploadPrefix] = useState("uploads/")
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([])

  const currentToken = pageTokens[pageIndex]

  const connectionQuery = useQuery({
    queryKey: ["s3-connection"],
    queryFn: getConnection,
    staleTime: 60_000,
    retry: 1,
  })

  const filesQuery = useQuery({
    queryKey: ["s3-files", prefix, pageSize, currentToken],
    queryFn: () =>
      listFiles({
        prefix,
        maxKeys: pageSize,
        continuationToken: currentToken,
      }),
    enabled: connectionQuery.data?.success === true,
    staleTime: 30_000,
    retry: 1,
  })

  useEffect(() => {
    if (!filesQuery.data?.success) {
      return
    }

    const nextToken = filesQuery.data.nextContinuationToken

    setPageTokens((previous) => {
      const trimmed = previous.slice(0, pageIndex + 1)

      if (!nextToken) {
        return trimmed.length === previous.length ? previous : trimmed
      }

      const currentValue = previous[pageIndex + 1]
      if (currentValue === nextToken && previous.length === pageIndex + 2) {
        return previous
      }

      return [...trimmed, nextToken]
    })
  }, [filesQuery.data, pageIndex])

  useEffect(() => {
    setRowSelection({})
  }, [pageIndex, prefix, currentToken])

  const openFileMutation = useMutation({
    mutationFn: (fileKey: string) => getFileUrl(fileKey),
    onSuccess: (result) => {
      if (result.success && result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer")
        setFeedback({ type: "success", message: "Opened file URL in a new tab." })
        return
      }

      setFeedback({
        type: "error",
        message: result.message || "Failed to generate file URL.",
      })
    },
    onError: () => {
      setFeedback({ type: "error", message: "Unexpected error while opening file URL." })
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (fileKeys: string[]) => deleteFilesFromS3(fileKeys),
    onSuccess: async (result) => {
      if (result.deletedKeys.length > 0) {
        await queryClient.invalidateQueries({ queryKey: ["s3-files"] })
      }

      setRowSelection({})

      if (result.success) {
        setFeedback({
          type: "success",
          message: result.message || `Deleted ${result.deletedKeys.length} file(s).`,
        })
        return
      }

      setFeedback({
        type: "error",
        message: result.message || "Some files could not be deleted.",
      })
    },
    onError: () => {
      setFeedback({ type: "error", message: "Unexpected error while deleting files." })
    },
  })

  const files = useMemo(() => filesQuery.data?.files ?? [], [filesQuery.data?.files])

  const totalSize = useMemo(() => files.reduce((acc, file) => acc + file.size, 0), [files])
  const lastUpdatedAt = useMemo(() => {
    if (files.length === 0) return null

    return files.reduce((latest, file) => {
      const currentTime = new Date(file.lastModified).getTime()
      const latestTime = latest ? new Date(latest).getTime() : 0
      return currentTime > latestTime ? file.lastModified : latest
    }, files[0]?.lastModified || null)
  }, [files])

  const updateUploadItem = (id: string, updates: Partial<UploadQueueItem>) => {
    setUploadQueue((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...updates } : item))
    )
  }

  const startUpload = async () => {
    if (uploadQueue.length === 0) {
      setFeedback({ type: "error", message: "Please choose at least one file before upload." })
      return
    }

    let successful = 0

    for (const item of uploadQueue) {
      updateUploadItem(item.id, { status: "uploading", progress: 0, message: undefined })

      try {
        const uploadUrlResult = await createUploadUrl({
          fileName: item.file.name,
          contentType: item.file.type || "application/octet-stream",
          prefix: uploadPrefix,
        })

        if (!uploadUrlResult.success || !uploadUrlResult.data) {
          updateUploadItem(item.id, {
            status: "error",
            message: uploadUrlResult.message || "Could not create upload URL.",
          })
          continue
        }

        await uploadObjectViaPresignedUrl({
          file: item.file,
          url: uploadUrlResult.data.url,
          contentType: item.file.type || "application/octet-stream",
          onProgress: (progress) => updateUploadItem(item.id, { progress }),
        })

        updateUploadItem(item.id, {
          status: "success",
          progress: 100,
          key: uploadUrlResult.data.key,
        })
        successful += 1
      } catch (error) {
        updateUploadItem(item.id, {
          status: "error",
          message: error instanceof Error ? error.message : "Upload failed.",
        })
      }
    }

    if (successful > 0) {
      await queryClient.invalidateQueries({ queryKey: ["s3-files"] })
    }

    if (successful === uploadQueue.length) {
      setFeedback({ type: "success", message: `Uploaded ${successful} file(s) successfully.` })
    } else {
      setFeedback({
        type: "error",
        message: `Uploaded ${successful}/${uploadQueue.length} file(s). Check failed items below.`,
      })
    }
  }

  const handlePickFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || [])

    if (picked.length === 0) {
      setUploadQueue([])
      return
    }

    setUploadQueue(
      picked.map((file, index) => ({
        id: `${file.name}-${file.lastModified}-${index}`,
        file,
        progress: 0,
        status: "queued",
      }))
    )
  }

  const clearUploadQueue = () => {
    setUploadQueue([])
    setFeedback(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleApplyPrefix = () => {
    const value = prefixDraft.trim()
    setPrefix(value)
    setPageIndex(0)
    setPageTokens([undefined])
    setFeedback(null)
  }

  const handleResetPrefix = () => {
    setPrefix("")
    setPrefixDraft("")
    setPageIndex(0)
    setPageTokens([undefined])
  }

  const handlePageSizeChange = (value: number) => {
    setPageSize(value)
    setPageIndex(0)
    setPageTokens([undefined])
  }

  const handlePreviousPage = () => {
    setPageIndex((previous) => Math.max(previous - 1, 0))
  }

  const handleNextPage = () => {
    const nextToken = filesQuery.data?.nextContinuationToken
    if (!nextToken) {
      return
    }

    setPageTokens((previous) => {
      if (previous[pageIndex + 1] === nextToken) {
        return previous
      }

      return [...previous.slice(0, pageIndex + 1), nextToken]
    })
    setPageIndex((previous) => previous + 1)
  }

  const handleCopyKey = useCallback(async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      setFeedback({ type: "success", message: "Object key copied to clipboard." })
    } catch {
      setFeedback({ type: "error", message: "Failed to copy object key." })
    }
  }, [])

  const handleDeleteSingle = useCallback((key: string) => {
    const shouldDelete = window.confirm(`Delete object \"${key}\"? This action cannot be undone.`)
    if (!shouldDelete) {
      return
    }

    bulkDeleteMutation.mutate([key])
  }, [bulkDeleteMutation])

  const columns: ColumnDef<S3File>[] = [
      {
        id: "select",
        header: ({ table }) => (
          <input
            aria-label="Select all objects on this page"
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            onChange={(event) => table.toggleAllRowsSelected(event.target.checked)}
          />
        ),
        cell: ({ row }) => (
          <input
            aria-label={`Select ${row.original.key}`}
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={(event) => row.toggleSelected(event.target.checked)}
          />
        ),
        enableSorting: false,
        enableColumnFilter: false,
      },
      {
        accessorKey: "key",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Object Key
            <ArrowUpDownIcon className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="max-w-96 truncate font-medium" title={row.original.key}>
            {row.original.key}
          </div>
        ),
      },
      {
        accessorKey: "size",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Size
            <ArrowUpDownIcon className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => <span>{formatBytes(row.original.size)}</span>,
      },
      {
        accessorKey: "lastModified",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Last Modified
            <ArrowUpDownIcon className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => <span>{formatDate(row.original.lastModified)}</span>,
      },
      {
        accessorKey: "storageClass",
        header: "Storage Class",
        cell: ({ row }) => row.original.storageClass || "-",
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="Open actions" />}
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => openFileMutation.mutate(row.original.key)}>
                <ExternalLinkIcon className="text-muted-foreground" />
                <span>Open</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCopyKey(row.original.key)}>
                <CopyIcon className="text-muted-foreground" />
                <span>Copy Key</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleDeleteSingle(row.original.key)}
                variant="destructive"
              >
                <Trash2Icon className="text-muted-foreground" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ]

  // TanStack Table intentionally returns non-memoizable APIs and is safe in this usage.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: files,
    columns,
    state: {
      sorting,
      columnFilters,
      rowSelection,
    },
    getRowId: (row) => row.key,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const isConnectionLoading = connectionQuery.isPending
  const isConnected = connectionQuery.data?.success === true
  const isFilesLoading = filesQuery.isPending
  const hasFilesError = filesQuery.data?.success === false
  const filteredRows = table.getFilteredRowModel().rows.length
  const selectedRows = table.getSelectedRowModel().rows
  const selectedKeys = selectedRows.map((row) => row.original.key)

  const canGoPrevious = pageIndex > 0
  const canGoNext = Boolean(filesQuery.data?.nextContinuationToken)
  const uploadInProgress = uploadQueue.some((item) => item.status === "uploading")

  const handleBulkDelete = () => {
    if (selectedKeys.length === 0) {
      setFeedback({ type: "error", message: "Select at least one file to delete." })
      return
    }

    const shouldDelete = window.confirm(
      `Delete ${selectedKeys.length} selected file(s)? This action cannot be undone.`
    )

    if (!shouldDelete) {
      return
    }

    bulkDeleteMutation.mutate(selectedKeys)
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#">Build Your Application</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Storage Control Center</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 bg-muted/20 p-4 md:p-6 lg:p-8">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-2">
                  <DatabaseIcon className="size-4" />
                  Connection
                </CardDescription>
                <CardTitle className="flex items-center gap-2 text-xl">
                  {isConnectionLoading && (
                    <>
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      Checking
                    </>
                  )}
                  {!isConnectionLoading && isConnected && (
                    <>
                      <CheckCircle2 className="size-5 text-green-500" />
                      Healthy
                    </>
                  )}
                  {!isConnectionLoading && !isConnected && (
                    <>
                      <XCircle className="size-5 text-destructive" />
                      Unavailable
                    </>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {connectionQuery.data?.data && (
                  <div>
                    {connectionQuery.data.data.provider} / {connectionQuery.data.data.bucketName}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-2">
                  <HardDriveIcon className="size-4" />
                  Current Page Objects
                </CardDescription>
                <CardTitle className="text-xl">
                  {filteredRows} / {filesQuery.data?.keyCount ?? files.length}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Page {pageIndex + 1} with server-side continuation tokens
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Total Size (Current Page)</CardDescription>
                <CardTitle className="text-xl">{formatBytes(totalSize)}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Aggregated from objects loaded on this page
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-2">
                  <Clock3Icon className="size-4" />
                  Latest Update (Current Page)
                </CardDescription>
                <CardTitle className="text-xl">
                  {lastUpdatedAt ? formatDate(lastUpdatedAt) : "-"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Most recent object modified timestamp
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UploadCloudIcon className="size-5" />
                Upload Panel
              </CardTitle>
              <CardDescription>
                Upload files directly to S3 using presigned URLs with real progress tracking.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
                <Input
                  placeholder="Upload prefix, e.g. uploads/2026/"
                  value={uploadPrefix}
                  onChange={(event) => setUploadPrefix(event.target.value)}
                />
                <input
                  ref={fileInputRef}
                  className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                  type="file"
                  multiple
                  onChange={handlePickFiles}
                />
                <div className="flex gap-2">
                  <Button onClick={startUpload} disabled={uploadQueue.length === 0 || uploadInProgress}>
                    {uploadInProgress ? (
                      <>
                        <Loader2 className="mr-1 size-4 animate-spin" />
                        Uploading
                      </>
                    ) : (
                      "Start Upload"
                    )}
                  </Button>
                  <Button variant="outline" onClick={clearUploadQueue} disabled={uploadInProgress}>
                    Clear
                  </Button>
                </div>
              </div>

              {uploadQueue.length > 0 && (
                <div className="space-y-2 rounded-lg border bg-background p-3">
                  {uploadQueue.map((item) => (
                    <div key={item.id} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate pr-3 font-medium">{item.file.name}</span>
                        <span className="text-muted-foreground">{formatBytes(item.file.size)}</span>
                      </div>
                      <div className="h-2 rounded bg-muted">
                        <div
                          className={cn(
                            "h-full rounded transition-all",
                            item.status === "error" && "bg-destructive",
                            item.status === "success" && "bg-green-500",
                            (item.status === "queued" || item.status === "uploading") && "bg-primary"
                          )}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {item.status === "queued" && "Queued"}
                          {item.status === "uploading" && `Uploading ${item.progress}%`}
                          {item.status === "success" && "Uploaded"}
                          {item.status === "error" && (item.message || "Upload failed")}
                        </span>
                        {item.key && <span className="truncate pl-3">{item.key}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {feedback && (
            <Alert variant={feedback.type === "error" ? "destructive" : "default"}>
              <AlertCircle className="size-4" />
              <AlertTitle>
                {feedback.type === "error" ? "Operation Failed" : "Operation Complete"}
              </AlertTitle>
              <AlertDescription>{feedback.message}</AlertDescription>
            </Alert>
          )}

          {connectionQuery.data?.success === false && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Connection Error</AlertTitle>
              <AlertDescription>
                {connectionQuery.data.message || "Could not connect to S3 provider."}
              </AlertDescription>
            </Alert>
          )}

          {hasFilesError && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Cannot Load Objects</AlertTitle>
              <AlertDescription>
                {filesQuery.data?.message || "Failed to list objects from the bucket."}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>S3 Objects</CardTitle>
              <CardDescription>
                Server-side pagination is active. Each page loads directly using S3 continuation tokens.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex w-full gap-2 lg:max-w-xl">
                  <Input
                    placeholder="Prefix filter, e.g. uploads/2026/"
                    value={prefixDraft}
                    onChange={(event) => setPrefixDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        handleApplyPrefix()
                      }
                    }}
                  />
                  <Button variant="outline" onClick={handleApplyPrefix}>
                    Apply
                  </Button>
                  <Button variant="ghost" onClick={handleResetPrefix}>
                    Reset
                  </Button>
                </div>

                <div className="flex w-full gap-2 lg:ml-auto lg:max-w-xl">
                  <div className="relative w-full">
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="Search by object key (current page)"
                      value={(table.getColumn("key")?.getFilterValue() as string) ?? ""}
                      onChange={(event) => table.getColumn("key")?.setFilterValue(event.target.value)}
                    />
                  </div>

                  <select
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={pageSize}
                    onChange={(event) => handlePageSizeChange(Number(event.target.value))}
                  >
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                    <option value={100}>100 / page</option>
                  </select>

                  <Button
                    variant="outline"
                    onClick={() => {
                      setFeedback(null)
                      connectionQuery.refetch()
                      filesQuery.refetch()
                    }}
                    disabled={connectionQuery.isFetching || filesQuery.isFetching}
                  >
                    <RefreshCwIcon className="mr-1 size-4" />
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border bg-background p-2">
                <div className="text-sm text-muted-foreground">
                  {selectedKeys.length} selected on this page
                </div>
                <Button
                  variant="destructive"
                  onClick={handleBulkDelete}
                  disabled={selectedKeys.length === 0 || bulkDeleteMutation.isPending}
                >
                  {bulkDeleteMutation.isPending ? (
                    <>
                      <Loader2 className="mr-1 size-4 animate-spin" />
                      Deleting
                    </>
                  ) : (
                    <>
                      <Trash2Icon className="mr-1 size-4" />
                      Delete Selected
                    </>
                  )}
                </Button>
              </div>

              {isFilesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <>
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                          <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                              <TableHead key={header.id}>
                                {header.isPlaceholder
                                  ? null
                                  : flexRender(header.column.columnDef.header, header.getContext())}
                              </TableHead>
                            ))}
                          </TableRow>
                        ))}
                      </TableHeader>
                      <TableBody>
                        {table.getRowModel().rows.length > 0 ? (
                          table.getRowModel().rows.map((row) => (
                            <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                              {row.getVisibleCells().map((cell) => (
                                <TableCell key={cell.id}>
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                              No objects found.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-muted-foreground">
                      Page {pageIndex + 1} • Showing {table.getRowModel().rows.length} row(s)
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={handlePreviousPage} disabled={!canGoPrevious}>
                        Previous
                      </Button>
                      <Button variant="outline" onClick={handleNextPage} disabled={!canGoNext}>
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default function Page() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <S3DashboardContent />
    </QueryClientProvider>
  )
}

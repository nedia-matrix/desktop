import type { PublishContentForm } from "./publishing.js";

export type Unsubscribe = () => void;

export interface ObservedHttpResponse {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readText(maxBytes: number): Promise<string>;
}

export interface ResponseStream {
  subscribe(listener: (response: ObservedHttpResponse) => void): Unsubscribe;
}

export interface ObservationPage {
  isTextVisible(text: string): Promise<boolean>;
  subscribeClose(listener: () => void): Unsubscribe;
}

export interface ObservationClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

export interface PublishObservationSession {
  responses: ResponseStream;
  page: ObservationPage;
}

export interface PublishMonitorContext {
  contentForm: PublishContentForm;
  submissionMode?: "automatic" | "manual_confirmation";
  session: PublishObservationSession;
  clock: ObservationClock;
  diagnostics: PublishMonitorDiagnostics;
}

export type PublishMonitorDiagnosticStage = "response" | "page";

export interface PublishMonitorDiagnostic {
  stage: PublishMonitorDiagnosticStage;
  code: string;
  message: string;
}

export interface PublishMonitorDiagnostics {
  report(diagnostic: PublishMonitorDiagnostic): void;
}

export type PublishResultEvent =
  | { kind: "verification_required"; message: string }
  | { kind: "verifying"; message: string }
  | { kind: "published"; contentId: string | null; contentUrl: string | null }
  | { kind: "failed"; message: string }
  | { kind: "uncertain"; message: string };

export interface PublishResultMonitor {
  subscribe(listener: (event: PublishResultEvent) => void): Unsubscribe;
  ready(): Promise<void>;
  arm(): void;
  stop(): void;
}

export type PublishMonitorState =
  "observing_draft" | "armed" | "verifying" | "completed";

export class PublishMonitorLifecycle {
  private currentState: PublishMonitorState = "observing_draft";

  get state(): PublishMonitorState {
    return this.currentState;
  }

  arm(): boolean {
    if (this.currentState !== "observing_draft") return false;
    this.currentState = "armed";
    return true;
  }

  beginVerification(): boolean {
    if (this.currentState !== "armed") return false;
    this.currentState = "verifying";
    return true;
  }

  requireVerification(): boolean {
    if (this.currentState !== "armed" && this.currentState !== "verifying") {
      return false;
    }
    this.currentState = "armed";
    return true;
  }

  complete(): boolean {
    if (this.currentState === "completed") return false;
    this.currentState = "completed";
    return true;
  }
}

export interface PlatformPublishRuntime {
  createResultMonitor(context: PublishMonitorContext): PublishResultMonitor;
}

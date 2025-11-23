export type HostMessage =
  | {
      type: "state";
      schema: unknown;
      value: unknown | null;
      errors: string[];
      parseError?: string;
    };

export type WebviewMessage =
  | {
      type: "ready";
    }
  | {
      type: "updateDoc";
      value: unknown;
    };

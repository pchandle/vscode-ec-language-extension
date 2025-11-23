export type VsCodeApi = {
  postMessage: (message: unknown) => void;
  setState?: (state: unknown) => void;
  getState?: () => unknown;
};

declare const acquireVsCodeApi: () => VsCodeApi;

export const vscode: VsCodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : {
        postMessage: () => undefined,
        setState: () => undefined,
        getState: () => undefined,
      };

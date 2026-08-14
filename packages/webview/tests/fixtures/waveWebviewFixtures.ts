export type HostToWebviewMessage = {
  command: string;
  [key: string]: unknown;
};

export const fixtures = {
  authStatusResponse: (
    isAuthenticated = true,
  ): HostToWebviewMessage => ({
    command: "authStatusResponse",
    isAuthenticated,
  }),
};

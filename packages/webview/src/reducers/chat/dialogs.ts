import type { ChatState, ChatAction } from "../../types";

type Action = Extract<ChatAction, { type: "SHOW_CONFIRMATION" | "HIDE_CONFIRMATION" | "SHOW_DIALOG" | "HIDE_DIALOG" | "SET_AUTHENTICATED" | "SET_LOGIN_ERROR" | "SET_CONFIGURATION_LOADING" | "SET_CONFIGURATION_ERROR" | "SET_CONFIGURATION_DATA" }>;

export function reduceDialogs(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "SHOW_CONFIRMATION":
      return {
        ...state,
        pendingConfirmations: [...state.pendingConfirmations, action.payload],
      };
    case "HIDE_CONFIRMATION":
      return {
        ...state,
        pendingConfirmations: state.pendingConfirmations.filter(
          (c) => c.confirmationId !== action.payload,
        ),
      };
    case "SHOW_DIALOG":
      return {
        ...state,
        activeDialog: action.payload.type,
        configurationData: action.payload.data ?? state.configurationData,
        configurationLoading: false,
        configurationError: action.payload.error,
        loginServiceName:
          action.payload.type === "login"
            ? action.payload.serviceName ?? "账号"
            : state.loginServiceName,
      };
    case "HIDE_DIALOG":
      return {
        ...state,
        activeDialog: null,
        configurationError: undefined,
        loginError: undefined,
      };
    case "SET_AUTHENTICATED":
      return {
        ...state,
        isAuthenticated: action.payload,
        initialized: true,
        loginError: action.payload ? undefined : state.loginError,
      };
    case "SET_LOGIN_ERROR":
      return {
        ...state,
        loginError: action.payload,
      };
    case "SET_CONFIGURATION_LOADING":
      return {
        ...state,
        configurationLoading: action.payload,
      };
    case "SET_CONFIGURATION_ERROR":
      return {
        ...state,
        configurationError: action.payload,
        configurationLoading: false,
      };
    case "SET_CONFIGURATION_DATA":
      return {
        ...state,
        configurationData: action.payload,
        configurationLoading: false,
      };
  }
}

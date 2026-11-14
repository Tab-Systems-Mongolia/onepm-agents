export const errorMessage = (error) =>
  error instanceof Error ? error.message : String(error);

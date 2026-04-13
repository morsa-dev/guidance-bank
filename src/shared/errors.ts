export class GuidanceBankCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuidanceBankCliError";
  }
}

export class ValidationError extends GuidanceBankCliError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class UserInputError extends GuidanceBankCliError {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

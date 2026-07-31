/** Error with an HTTP status code, safe to expose to the client. */
export class HttpError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export type User = {
    id: string;
    email: string;
    name: string;
    picture?: string;
};

export type Session = {
    userId: string;
    expiresAt: number;
};

export type IssuedEphemeralToken = {
    token: string;
    userId: string;
    targetLanguageCode: string;
    issuedAt: number;
    expiresAt: number;
};

export const mockDatabase = {
    users: new Map<string, User>(),
    sessions: new Map<string, Session>(),
    issuedEphemeralTokens: [] as IssuedEphemeralToken[],
};

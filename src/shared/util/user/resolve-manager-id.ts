export type SleeperUserLike = {
    user_id: string;
    username: string;
    display_name: string;
    avatar: string | null;
};

export type ManagerLookup = (
    usernameOrId: string,
) => Promise<SleeperUserLike | null>;

export type ResolvedManagerId =
    | {
        ok: true;
        userId: string;
        /**
         * The Sleeper user, where one had to be fetched — null when the id came
         * from the caller, which is exactly when nothing needed it. A route that
         * *does* need the profile (an avatar, a canonical username) must resolve
         * rather than hint; see `resolveManagerUser`.
         */
        user: SleeperUserLike | null;
    }
    | { ok: false; status: 400 | 404 | 502; error: string };

const MAX_USER_ID_LENGTH = 32;

export function isSleeperUserId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= MAX_USER_ID_LENGTH &&
        /^[0-9]+$/.test(value)
    );
}

export async function resolveManagerId(
    username: string,
    hintedId: unknown,
    lookup: ManagerLookup,
): Promise<ResolvedManagerId> {
    if (isSleeperUserId(hintedId)) {
        return { ok: true, userId: hintedId, user: null };
    }
    if (!username?.trim()) {
        return { ok: false, status: 400, error: "Username is required" };
    }

    let user: SleeperUserLike | null;
    try {
        user = await lookup(username);
    } catch {
        return { ok: false, status: 502, error: "Failed to reach Sleeper" };
    }
    if (!user) return { ok: false, status: 404, error: "User not found" };
    return { ok: true, userId: user.user_id, user };
}
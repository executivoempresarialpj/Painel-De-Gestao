export const authCookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  maxAge: 400 * 24 * 60 * 60
}

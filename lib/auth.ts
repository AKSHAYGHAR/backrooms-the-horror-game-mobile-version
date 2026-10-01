import { NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";

export const authOptions: NextAuthOptions = {
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID || "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "discord") {
        try {
          const connectToDatabase = (await import("./mongodb")).default;
          const User = (await import("../models/User")).default;
          await connectToDatabase();
          const userExists = await User.findOne({ email: user.email });

          if (!userExists) {
            await User.create({
              email: user.email,
              name: user.name,
              image: user.image,
              gamesPlayed: 0,
              highScore: 0,
            });
          }
          return true;
        } catch (error) {
          console.error("Error checking/creating user in DB:", error);
          return false;
        }
      }
      return true;
    },
    async session({ session, token }) {
      if (session?.user?.email) {
        try {
          const connectToDatabase = (await import("./mongodb")).default;
          const User = (await import("../models/User")).default;
          await connectToDatabase();
          const dbUser = await User.findOne({ email: session.user.email });
          if (dbUser) {
            (session.user as any).gamesPlayed = dbUser.gamesPlayed;
            (session.user as any).highScore = dbUser.highScore;
          }
        } catch (error) {
          console.error("Error fetching user session data:", error);
        }
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

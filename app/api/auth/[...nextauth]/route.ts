import NextAuth, { NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import connectToDatabase from "../../../../lib/mongodb";
import User from "../../../../models/User";

export const authOptions: NextAuthOptions = {
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "discord") {
        await connectToDatabase();
        try {
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
        await connectToDatabase();
        const dbUser = await User.findOne({ email: session.user.email });
        if (dbUser) {
          // You can attach db stats to session if needed
          (session.user as any).gamesPlayed = dbUser.gamesPlayed;
          (session.user as any).highScore = dbUser.highScore;
        }
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import connectToDatabase from "../../../lib/mongodb";
import User from "../../../models/User";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const body = await req.json();
    const { pages, won, email, name, image } = body;

    const userEmail = session?.user?.email || email;

    if (!userEmail) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    await connectToDatabase();

    let user = await User.findOne({ email: userEmail });
    
    if (!user) {
      // If user logged in via Firebase and doesn't exist in MongoDB yet, create them
      user = await User.create({
        email: userEmail,
        name: name || "Unknown User",
        image: image || "",
        gamesPlayed: 0,
        highScore: 0,
      });
    }

    user.gamesPlayed += 1;
    if (pages > user.highScore) {
      user.highScore = pages;
    }

    await user.save();

    return new Response(JSON.stringify({ success: true, user }), {
      status: 200,
    });
  } catch (error) {
    console.error("Error updating stats:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
    });
  }
}

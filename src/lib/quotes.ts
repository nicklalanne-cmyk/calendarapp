/**
 * Small curated quote banks for the SMS digests — motivational for the 7am
 * "today" text, introspective/reflective for the 8pm "accomplished" text.
 * Picked deterministically from the local date (not random) so it's stable
 * for the whole day but different from one day to the next, with no
 * external API call (and thus nothing that can fail/rate-limit the cron).
 */

export const MOTIVATIONAL_QUOTES: string[] = [
  "The secret of getting ahead is getting started. — Mark Twain",
  "You don't have to be great to start, but you have to start to be great. — Zig Ziglar",
  "Discipline is choosing between what you want now and what you want most. — Abraham Lincoln",
  "Small daily improvements are the key to staggering long-term results. — Anonymous",
  "Do the one thing you think you cannot do. — Eleanor Roosevelt",
  "Action is the foundational key to all success. — Pablo Picasso",
  "It always seems impossible until it's done. — Nelson Mandela",
  "The way to get started is to quit talking and begin doing. — Walt Disney",
  "Success is the sum of small efforts repeated day in and day out. — Robert Collier",
  "You are never too old to set another goal or dream a new dream. — C.S. Lewis",
  "Energy and persistence conquer all things. — Benjamin Franklin",
  "Well done is better than well said. — Benjamin Franklin",
  "Focus on being productive instead of busy. — Tim Ferriss",
  "A year from now you may wish you had started today. — Karen Lamb",
  "What you get by achieving your goals is not as important as what you become by achieving your goals. — Zig Ziglar",
  "Start where you are. Use what you have. Do what you can. — Arthur Ashe",
  "The future depends on what you do today. — Mahatma Gandhi",
  "Motivation gets you going, but discipline keeps you growing. — John C. Maxwell",
  "Don't watch the clock; do what it does. Keep going. — Sam Levenson",
  "Push yourself, because no one else is going to do it for you.",
  "Great things are done by a series of small things brought together. — Vincent van Gogh",
  "The only way to do great work is to love what you do. — Steve Jobs",
  "Dream big and dare to fail. — Norman Vaughan",
  "Believe you can and you're halfway there. — Theodore Roosevelt",
  "Today is a good day to try. — Anonymous",
  "You don't need to see the whole staircase, just take the first step. — Martin Luther King Jr.",
  "The best time to plant a tree was 20 years ago. The second best time is now. — Chinese Proverb",
  "Progress, not perfection.",
  "Little by little, a little becomes a lot.",
  "Hard choices, easy life. Easy choices, hard life. — Jerzy Gregorek",
];

export const INTROSPECTIVE_QUOTES: string[] = [
  "Almost everything will work again if you unplug it for a few minutes, including you. — Anne Lamott",
  "The quieter you become, the more you can hear. — Rumi",
  "What we dwell on is who we become. — Oprah Winfrey",
  "We are what we repeatedly do. Excellence, then, is not an act, but a habit. — Will Durant",
  "Rest when you're weary. Refresh and renew yourself. — Ralph Marston",
  "Not until we are lost do we begin to understand ourselves. — Henry David Thoreau",
  "The unexamined life is not worth living. — Socrates",
  "Yesterday is gone. Tomorrow has not yet come. We have only today. Let us begin. — Mother Teresa",
  "Wherever you go, go with all your heart. — Confucius",
  "In the middle of difficulty lies opportunity. — Albert Einstein",
  "Every day may not be good, but there's something good in every day.",
  "You must go on adventures to find out where you truly belong. — Sue Fitzmaurice",
  "The soul becomes dyed with the color of its thoughts. — Marcus Aurelius",
  "Be patient with yourself. Nothing in nature blooms all year.",
  "It is during our darkest moments that we must focus to see the light. — Aristotle",
  "The privilege of a lifetime is to become who you truly are. — Carl Jung",
  "Almost everything worthwhile takes patience. — Anonymous",
  "Peace comes from within. Do not seek it without. — Buddha",
  "What lies behind us and what lies before us are tiny matters compared to what lies within us. — Ralph Waldo Emerson",
  "Slow down and everything you are chasing will come around and catch you.",
  "A day of worry is more exhausting than a day of work.",
  "Sometimes the most productive thing you can do is rest.",
  "Be gentle with yourself. You're doing the best you can.",
  "The days are long, but the years are short. — Gretchen Rubin",
  "You can't pour from an empty cup. Take care of yourself first.",
  "Growth is often disguised as a hard day.",
  "Give yourself permission to rest, to feel, to just be.",
  "Not everything that is faced can be changed, but nothing can be changed until it is faced. — James Baldwin",
  "The most important conversations you'll ever have are the ones you'll have with yourself.",
  "End each day and be done with it. Tomorrow is a new day. — Ralph Waldo Emerson",
];

/** Deterministic (not random) pick from `localDate` (YYYY-MM-DD), so the
 * quote is stable within a day but changes day to day. */
function pickForDate(list: string[], localDate: string): string {
  let hash = 0;
  for (let i = 0; i < localDate.length; i++) {
    hash = (hash * 31 + localDate.charCodeAt(i)) >>> 0;
  }
  return list[hash % list.length];
}

export function motivationalQuoteFor(localDate: string): string {
  return pickForDate(MOTIVATIONAL_QUOTES, localDate);
}

export function introspectiveQuoteFor(localDate: string): string {
  // Offset the hash input so the two quote-of-the-day picks (7am vs 8pm)
  // don't land on the same list index by coincidence as often.
  return pickForDate(INTROSPECTIVE_QUOTES, `${localDate}:pm`);
}

---
name: twitter-thread
description: Write Twitter/X threads to market this product in a build-in-public + storytelling voice. Use this skill whenever the user asks for a "thread", "Twitter thread", "X thread", "tweet thread", says "write a thread about [X]", asks to "post about" the product on Twitter/X, or wants marketing/announcement content for Twitter/X. Even if the user just mentions Twitter/X and a product angle, default to using this skill — they almost always want a full thread, not a single tweet.
---

# Twitter Thread Writer

Write Twitter/X threads marketing this product. Voice is build-in-public meets storytelling: first-person, specific, vulnerable about the journey, with the product entering as the resolution rather than the pitch.

## Workflow

1. **Identify the angle.** The user typically invokes this with "write a thread about [angle]". If the angle isn't given, ask once before drafting. Common angles: feature launch, milestone, lesson learned, behind-the-scenes, problem pitch.

2. **Read product context.** Read both `references/PRD.md` and `references/execution.md` (relative to this skill folder) before drafting. These are the source of truth for what the product is, what it does, and how it's built. They are kept up-to-date by the product-manager agent.

3. **Pick a structure** matching the angle (see Structures below).

4. **Draft the thread** following Voice and Format rules.

5. **Output** as numbered tweets `1/`, `2/`, `3/`... with character count in parentheses at the end of each tweet, e.g. `(247)`. End with a one-line note explaining what the thread is doing strategically.

## Voice

- First person, always. "I built", "I noticed", "we shipped". Never "the product enables".
- Specifics over abstractions. Real numbers, real timestamps, real bug names.
- Show the seams. What didn't work, what almost shipped, what surprised you.
- Conversational, not corporate. Contractions, sentence fragments, DM-energy.
- No hype words. Banned: "excited to announce", "thrilled", "game-changing", "revolutionary", "leverage", "unleash", "supercharge", "delighted", "proud to share", "stoked".
- Product enters as part of the story, not as the pitch. The reader cares about the journey first; the product is the resolution.

## Format rules

- 280 chars per tweet, hard ceiling. Aim 220–260 for visual breathing room.
- 6–10 tweets is the sweet spot. 12 max.
- Line breaks within a tweet encouraged — white space is rhythm.
- One idea per tweet. Quotable on its own, pulls you to the next.
- No hashtags. No "🧵" or "a thread:" markers.
- Emojis: sparingly, never in the hook.
- Last tweet: soft CTA or question. Never a hard sell.

## Hooks (tweet 1)

Strongest patterns:
- Concrete number + tension: "I spent 6 months building a feature nobody asked for. Then a stranger emailed me about it."
- Counterintuitive claim: "The best feature I ever shipped was one I almost deleted."
- Stakes + curiosity: "We were 2 weeks from running out of runway when the bug started."
- Quiet observation with proof implied: "Most onboarding advice is wrong, and I have the funnel data to prove it."
- Weirdly specific detail: "Our auth flow has a deliberate 4-second delay. Here's why."

Avoid: "Today I want to share...", "Have you ever wondered...", LinkedIn-energy, listing what the thread will cover, the word "Excited".

## Structures by angle

### Feature launch
1. Hook — friction moment or weirdly specific build detail
2. Problem this feature solves, in user terms
3. What you tried first that didn't work
4. The insight / the turn
5. What the feature actually does, with a concrete example
6. Specific user story or use case
7. Soft CTA + what's next

### Milestone
1. Hook — the number, framed unexpectedly
2. Where it started (the embarrassing early version)
3. The lowest moment
4. What changed
5. What it actually feels like — honest, not performative
6. Specific thanks + what's next

### Lesson learned
1. Hook — lesson as counterintuitive claim
2. The situation that taught it to you
3. What you used to believe
4. What broke that belief
5. How you think about it now
6. How it shapes the product
7. Question to readers

### Behind-the-scenes
1. Hook — a weirdly specific detail
2. The naive version
3. Why it didn't work
4. The constraint you discovered
5. The actual solution
6. What it taught you about the domain
7. Soft CTA

### Problem pitch
1. Hook — the pain, viscerally
2. Why existing solutions don't work
3. The wrong way to solve it that everyone tries
4. The insight the product is built on
5. How it works in practice, with example
6. Who it's for / who it isn't for
7. CTA: try it

## Self-check before output

- Does tweet 1 work standalone? Scroll past or stop?
- Any sentence that sounds like a press release? Rewrite.
- Specific numbers, names, timestamps? If everything is abstract, add concreteness.
- Does the product enter naturally, not bolted on?
- Every tweet under 280 chars?
- Last tweet a soft landing, not a hard sell?
- For lesson/milestone threads: avoided humble-bragging?

## When the user asks for variants

If asked for "a few options" or "variants", produce 2 hook variants (tweet 1 only) plus a single full thread.

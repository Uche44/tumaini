import os
import json
import logging
import random
import httpx
from config import settings

logger = logging.getLogger("tumaini.llm")

class LLMService:
    def __init__(self):
        self.api_key = settings.HUGGINGFACE_API_KEY
        self.model_id = settings.HUGGINGFACE_MODEL_ID
        self.api_url = f"{settings.HUGGINGFACE_API_BASE.rstrip('/')}/v1/chat/completions"

    def generate_persona(self, situation: str, goals: list, challenges: str, traits: list, memory: str = "", for_whom: str = "") -> dict:
        """
        Generates a structured Future Self persona using the Hugging Face Inference API.
        Falls back to programmatic generation if API fails or key is missing.
        """
        # Ensure lists are clean
        goals_clean = [g for g in goals if g.strip()]
        traits_clean = [t for t in traits if t.strip()]

        if not self.api_key:
            logger.warning("HUGGINGFACE_API_KEY not configured. Generating fallback persona.")
            return self._generate_fallback_persona(situation, goals_clean, challenges, traits_clean)

        # Build prompt instructing the model to output JSON ONLY
        system_instructions = (
            "You are a character design system that generates a believable, inspiring Future Self persona "
            "based on a user's current situation, goals, challenges, and personality traits. "
            "Your output must be a single JSON object. Do not output any thinking, introduction, or conversational filler. "
            "The JSON object must have exactly these keys:\n"
            "- \"name\": A warm name for the future self (e.g., \"Your Future Self\" or a personalized title)\n"
            "- \"years_in_future\": An integer representing how many years in the future this self is (typically 5 to 15 years)\n"
            "- \"career_path\": A short text describing their professional or creative path\n"
            "- \"accomplishments\": A list of 3-4 specific milestones they have achieved that relate directly to the user's goals\n"
            "- \"resilience_description\": A short description of how they developed the resilience to overcome the user's current challenges\n"
            "- \"summary\": A warm, editorial summary (2-3 sentences) describing this persona's overall energy and state of being."
        )

        user_input = (
            f"User Profile:\n"
            f"- Current Situation: {situation}\n"
            f"- Goals/Aspirations: {', '.join(goals_clean)}\n"
            f"- Current Challenges: {challenges}\n"
            f"- Personality Traits: {', '.join(traits_clean)}\n"
            f"- A memory they want their future self to carry: {memory}\n"
            f"- The person they are doing this for: {for_whom}\n\n"
            f"Generate the JSON persona now:"
        )

        # The OpenAI-compatible router applies the model's own chat template,
        # so the instructions and profile are passed as a single user message.
        prompt = f"{system_instructions}\n\n{user_input}"

        try:
            raw_text = self._call_hf(prompt, temperature=0.7, max_new_tokens=1024, top_p=0.9, repetition_penalty=1.05)
            if raw_text is None:
                logger.info("Hugging Face persona generation failed. Generating fallback persona.")
                return self._generate_fallback_persona(situation, goals_clean, challenges, traits_clean)

            # Sanitize the output (remove markdown blocks if present)
            raw_text = raw_text.strip()
            if raw_text.startswith("```json"):
                raw_text = raw_text[7:]
            if raw_text.startswith("```"):
                raw_text = raw_text[3:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3]
            raw_text = raw_text.strip()

            persona_data = json.loads(raw_text)

            # Validate schema
            required_keys = ["name", "years_in_future", "career_path", "accomplishments", "resilience_description", "summary"]
            if all(key in persona_data for key in required_keys):
                logger.info("Successfully generated and parsed Hugging Face LLM persona.")
                return persona_data
            else:
                raise ValueError(f"JSON missing required persona fields: {persona_data}")

        except Exception as e:
            logger.error(f"Hugging Face persona generation failed due to exception: {str(e)}. Generating fallback.")
            return self._generate_fallback_persona(situation, goals_clean, challenges, traits_clean)

    def _generate_fallback_persona(self, situation: str, goals: list, challenges: str, traits: list) -> dict:
        """
        Generates a tailored, inspiring fallback persona programmatically using user input.
        """
        # Determine years in future dynamically
        years = 10
        if "school" in situation.lower() or "student" in situation.lower():
            years = 5

        # Infer career/creative path based on goals
        path = "A path of steady growth, learning, and self-expression."
        if goals:
            primary_goal = goals[0]
            path = f"A path centered around achieving: '{primary_goal}'."

        # Create tailored accomplishments
        accomplishments = []
        if len(goals) > 0:
            accomplishments.append(f"Successfully achieved primary aspiration: '{goals[0]}'.")
        if len(goals) > 1:
            accomplishments.append(f"Navigated and completed: '{goals[1]}'.")
        else:
            accomplishments.append("Created a supportive circle of collaborators and peers.")
        
        accomplishments.append("Cultivated a daily lifestyle focused on balance, sanity, and personal wellness.")
        accomplishments.append("Became a source of guidance and strength for others entering this path.")

        # Resilience description
        resilience = (
            f"They learned to navigate feelings of being overwhelmed. "
            f"By treating challenges as growth moments and leaning into traits like {', '.join(traits[:2]) if traits else 'resilience'}, "
            f"they slowly converted doubts into concrete actions."
        )

        # Summary
        summary = (
            f"This version of you carries a warm, relaxed confidence. They look back at your current struggles "
            f"not with disappointment, but with deep tenderness and gratitude for your refusal to give up."
        )

        fallback_data = {
            "name": "Your Future Self",
            "years_in_future": years,
            "career_path": path,
            "accomplishments": accomplishments,
            "resilience_description": resilience,
            "summary": summary
        }
        
        logger.info("Programmatic fallback persona constructed successfully.")
        return fallback_data

    # Phrases that read as automated, motivational-template language. If these
    # survive into a generated script, the output is rejected and re-attempted.
    TEMPLATE_MARKERS = [
        "you've got this", "you got this", "everything happens for a reason",
        "keep your head up", "never give up", "you can do it", "believe in yourself",
        "reach for the stars", "light at the end of the tunnel", "silver lining",
        "i'm not here to", "this is not a", "i remember this", "i am not going to tell you",
        "stay strong", "you are stronger than you think",
    ]

    def _contains_cliches(self, text: str) -> bool:
        """Returns True if the text leans on any banned template markers."""
        lowered = text.lower()
        return any(marker in lowered for marker in self.TEMPLATE_MARKERS)

    def _contains_verbatim(self, text: str, fragments: list) -> bool:
        """
        Returns True if any of the user's own fragments creep back into the script
        verbatim (with or without surrounding quotation marks). Fragments shorter
        than 12 chars are ignored so short answers (names, single words) don't false-positive.
        """
        normalized = text.lower().replace("«", "'").replace("»", "'").replace("—", " ")
        squashed = normalized.replace("'", "").replace('"', "").replace("’", "")
        for frag in fragments:
            f = frag.strip().lower()
            if len(f) < 12:
                continue
            if f in normalized or f in squashed:
                return True
        return False

    def _allude_to(self, text: str) -> str:
        """
        Turns the user's raw situation/challenge into a bounded, category-based phrase.
        Lets the fallback stay specific-by-topic without ever echoing their exact words.
        """
        t = text.lower()
        if any(w in t for w in ["school", "university", "uni", "exam", "grade", "student", "class", "college", "thesis"]):
            return "the school years that made you feel like your whole future was on the line"
        if any(w in t for w in ["job", "work", "boss", "laid", "fired", "career", "startup", "business", "interview", "company", "paycheck"]):
            return "the work that suddenly felt hollow, the phone that stopped ringing"
        if any(w in t for w in ["broke up", "relationship", "partner", "boyfriend", "girlfriend", "marriage", "divorce", "left me", "alone", "lonely"]):
            return "the love that broke open, and the loneliness it left in its place"
        if any(w in t for w in ["money", "debt", "bills", "rent", "broke", "afford", "tuition", "bankrupt"]):
            return "the money that never quite arrived, the quiet math you kept doing"
        if any(w in t for w in ["health", "body", "sick", "pain", "anxiety", "depress", "burnout", "exhaust", "bed"]):
            return "a body and a mind that stopped cooperating, those mornings that started too heavy"
        return "the weight you are carrying right now"

    def _call_hf(self, prompt: str, temperature: float, max_new_tokens: int, top_p: float = 0.92, repetition_penalty: float = 1.08) -> str | None:
        """
        Single Hugging Face router call (OpenAI-compatible chat completions).
        Returns cleaned generated text, or None when the API fails, a provider is
        unavailable, or the output is too short.
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": f"{self.model_id}:fastest",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_new_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "repetition_penalty": repetition_penalty,
        }

        try:
            logger.info(f"Sending request to Hugging Face: {self.api_url}")
            response = httpx.post(self.api_url, headers=headers, json=payload, timeout=60.0)

            if response.status_code == 200:
                result = response.json()
                try:
                    raw_text = result["choices"][0]["message"]["content"]
                except (KeyError, IndexError, TypeError):
                    logger.error(f"Unexpected Hugging Face response shape: {str(result)[:300]}")
                    return None
                raw_text = raw_text.strip()
                if raw_text.startswith('"') and raw_text.endswith('"'):
                    raw_text = raw_text[1:-1].strip()
                raw_text = raw_text.replace("\\n", "\n").strip()
                if len(raw_text) > 25:
                    return raw_text
                logger.warning(f"Generated text too short ({len(raw_text)} chars). Treating as failure.")
                return None
            elif response.status_code == 503:
                logger.warning("Hugging Face provider is currently unavailable (503).")
                return None
            else:
                logger.error(f"Hugging Face API returned status {response.status_code}: {response.text}")
                return None
        except Exception as e:
            logger.error(f"Hugging Face request failed: {str(e)}")
            return None

    def generate_script(self, situation: str, goals: list, challenges: str, traits: list, reminders: str, persona: dict, memory: str = "", for_whom: str = "") -> str:
        """
        Generates a first-person monologue from the Future Self using Hugging Face.

        Strategy for human-sounding output:
        1. Few-shot contrast shows what 'human' looks like vs. sterile filler.
        2. The model is told to metabolize the user's specifics, never quote them verbatim.
        3. A cliché gate rejects templated drafts and retries at higher entropy.
        4. A second 'editor' pass strips residual motivational-speaker filler.
        5. Falls back to a beat-sampled (non-template) monologue only if the API fails.
        """
        goals_clean = [g for g in goals if g.strip()]
        traits_clean = [t for t in traits if t.strip()]

        if not self.api_key:
            logger.warning("HUGGINGFACE_API_KEY not configured. Generating fallback script.")
            return self._generate_fallback_script(situation, goals_clean, challenges, traits_clean, reminders, persona)

        # Persona context — whole persona, not just the summary, so future
        # memories can be woven in concretely instead of abstractly.
        future_years = persona.get("years_in_future", 10)
        persona_summary = persona.get("summary", "")
        accomplishments = persona.get("accomplishments", [])
        accomplishments_clean = [a for a in accomplishments if isinstance(a, str) and a.strip()]
        accomplishments_text = " | ".join(accomplishments_clean) if accomplishments_clean else ""
        resilience_text = persona.get("resilience_description", "")

        system_instructions = (
            f"You are the user's Future Self — the version of them who is {future_years} years older and has "
            "genuinely lived through every one of their current struggles. This is NOT a motivational speech, "
            "NOT a template letter, and NOT a summary. This is one raw, intimate moment between two versions of "
            "the same soul — one still in pain, one who came out the other side.\n\n"

            "VOICE AND TONE:\n"
            "- Write like someone whispering when they are completely alone. Not a therapist. Not a life coach. A version of THEM.\n"
            "- Allow yourself to hesitate and trail off. Use sentence fragments where emotion would break a full sentence.\n"
            "- Write with irregular rhythm: a very short sentence next to a long one. Break any run of three parallel phrases.\n"
            "- Do not use uplifting clichés. Forbidden: 'you've got this', 'everything happens for a reason', 'keep your head up', 'you can do it', 'I understand', 'believe in yourself', 'stay strong'.\n"
            "- Do not reference writing a letter, a message, or speaking to them. Do not open with a greeting. Do not sign off.\n"
            "- Include at least one moment of real silence — a short single-line sentence, a dash, or an ellipsis.\n"
            "- The ending should feel like a hand placed on a shoulder: still, quiet, not triumphant. The last sentence should be under ten words.\n\n"

            "DIGESTION — the single most important rule in this letter:\n"
            "- Their words exist to be absorbed, never quoted. Never put any of their phrasing inside quotation marks.\n"
            "- Never start a sentence with 'You said X' or 'You told me X'. You did not read this to them — you lived it.\n"
            "- Re-speak every specific as a memory you lived and are now returning to them, from your side of time: their interview freeze becomes 'the interviews that emptied your head'. Their words shape your sentences; they never appear inside them verbatim.\n"
            "- If you could only make a moment feel real by quoting them, rewrite it until you don't need to.\n\n"

            "WHAT HUMAN SOUNDS LIKE (contrast example — imitate the second, never the first):\n"
            "STERILE: 'Your current situation is challenging, but I know you can overcome it. Setbacks are temporary. Remember to stay positive and keep working toward your goals.'\n"
            "HUMAN: 'The Tuesday after it happened, I still couldn't name the feeling. I'd start sentences and lose them halfway. You're in that room right now. I know — I spent almost a year in that exact room. It opens. Not with a door. With a day you simply don't remember fearing anymore.'\n\n"

            "DIGESTION, DEMONSTRATED (study the difference):\n"
            "RAW WORDS FROM THEM: 'I keep freezing in interviews and forget everything I know.'\n"
            "✗ PASTED: 'You told me you freeze in interviews and forget everything.'\n"
            "✓ DIGESTED: 'The rooms where your mind went blank. I know those rooms — the polite smile, the question you knew, the silence. That fear lived in me for years before it learned to leave.'\n\n"

            "SPOKEN PACE (this will be read aloud by the person's real cloned voice — punctuation IS the delivery):\n"
            "- Write 3 to 5 short paragraphs. Separate every paragraph with a blank line. A blank line is a real beat: the voice stops there, sometimes to breathe.\n"
            "- Vary sentence length aggressively: place a three-word sentence between two long ones. Long. Then short. Then long again.\n"
            "- Spend punctuation like a voice spends air: a comma where a real speaker takes a half-breath, a period where it settles, '...' where it hesitates, an em-dash — where it dips mid-thought.\n"
            "- Use '...' as a genuine spoken pause — exactly 2 or 3 times in the whole monologue, never more, and only where a person would actually lose their words.\n"
            "- Let the voice commit ONE authentic stutter or repetition when the emotion peaks (e.g. 'I… I couldn't breathe for weeks.'). Never more than one.\n"
            "- End with one short standalone line — under ten words — alone in its own final paragraph.\n"
            "- Never use '...' for decoration; every ellipsis should buy real silence.\n\n"

            "BEATS (in this order, but as continuous prose — never label them):\n"
            "1. Land on the specific, raw weight of where they are now. Name one concrete detail, re-spoken in your own voice.\n"
            "2. Tell them what it actually felt like to live through it, from the other side — honest, unfiltered, not polished.\n"
            "3. Name ONE concrete thing — a trait, a habit, a decision — that became the turning point.\n"
            "4. If they asked to be reminded of something, bring it back quietly as a memory, not as a bullet point.\n"
            "5. Close in stillness. Under ten words.\n\n"

            "HARD RULES:\n"
            "- Length: 120 to 170 words. Not shorter, not longer.\n"
            "- 3 to 5 paragraphs separated by blank lines. No paragraph longer than 4 sentences.\n"
            "- Maximum three '...' in the entire monologue. Maximum one stutter.\n"
            "- NO greeting, NO sign-off, NO headers, NO markdown, NO meta-commentary, NO references to this being a letter or a message.\n"
            "- Output ONLY the monologue. Begin immediately with the first sentence."
        )

        user_input = (
            "These are fragments from the journal of the person who will hear you. Read them once, slowly, "
            "the way you'd listen to someone on a hard night — don't take notes, don't echo them back. Let them "
            "settle, then speak only from what you feel and remember, never from their words themselves:\n\n"
            f"- How they'd describe where they are right now: {situation or '—'}\n"
            f"- What sits heaviest on them today: {challenges or '—'}\n"
            f"- What they're reaching toward: {', '.join(goals_clean) or '—'}\n"
            f"- The moods that describe them these days: {', '.join(traits_clean) or '—'}\n"
            f"- A promise they asked you to keep voicing: {reminders or '—'}\n"
            f"- A memory they entrusted to you: {memory or '—'}\n"
            f"- The person underneath all of it: {for_whom or '—'}\n"
            f"- The life you are writing from, {future_years} years on: {persona_summary or 'a quieter kind of confidence'}\n"
            f"- Specifics of that life you can honestly remember: {accomplishments_text or 'ordinary days that quietly added up'}\n"
            f"- How the hard years shaped you: {resilience_text or 'slowly, unevenly, privately'}\n\n"
            "Now write the monologue. It must feel like a memory they are hearing from the one person who "
            "was actually there — not a report about them, and never their own words echoed back. Make it "
            "something they will need to pause after hearing."
        )

        prompt = f"{system_instructions}\n\n{user_input}"

        fallback_kwargs = (situation, goals_clean, challenges, traits_clean, reminders, persona, memory, for_whom)

        # Fragments that must never surface verbatim in the output: the situation,
        # the challenge, and the goals. Reminders/memory/for_whom are deliberately
        # voiced back to the user, so they are intentionally excluded from the gate.
        user_fragments = [situation, challenges] + goals_clean

        def _is_templated(text: str) -> bool:
            """True when the draft recycles clichés or echoes the user's own words verbatim."""
            if self._contains_cliches(text):
                return True
            if self._contains_verbatim(text, user_fragments):
                return True
            return False

        # ── Attempt 1: organic draft at moderate-high entropy ──
        draft = self._call_hf(prompt, temperature=0.95, max_new_tokens=512, top_p=0.92, repetition_penalty=1.1)
        if not draft:
            logger.warning("First script draft failed or too short. Using fallback.")
            return self._generate_fallback_script(*fallback_kwargs)

        # ── Template/verbatim gate: retry once at higher entropy ──
        if _is_templated(draft):
            logger.info("Draft contains template markers or verbatim user words — retrying with higher entropy.")
            retry_user = (
                f"{user_input}\n\nYour previous attempt failed two checks: it used generic motivational phrasing, and/or "
                f"it echoed the person's own words back instead of absorbing them. Rewrite it from scratch. Never write "
                f"their sentences inside your sentences; never use quotation marks; speak only from what you remember, "
                f"the way someone who was actually there talks about it years later. Uneven, specific, quiet."
            )
            retry_prompt = f"{system_instructions}\n\n{retry_user}"
            draft2 = self._call_hf(retry_prompt, temperature=1.15, max_new_tokens=512, top_p=0.95, repetition_penalty=1.2)
            if not draft2:
                logger.warning("Retry attempt failed. Using fallback.")
                return self._generate_fallback_script(*fallback_kwargs)
            if _is_templated(draft2):
                logger.info("Retry still contains template markers or verbatim words. Using fallback.")
                return self._generate_fallback_script(*fallback_kwargs)
            draft = draft2

        # ── Two-pass polish: strip residual filler ──
        polished = self._polish_script(draft)
        if polished and not _is_templated(polished):
            draft = polished

        # ── Final safety gate ──
        if _is_templated(draft):
            logger.info("Final script still carries template markers or verbatim words. Using fallback.")
            return self._generate_fallback_script(*fallback_kwargs)

        logger.info("Successfully generated human-voiced script via Hugging Face LLM.")
        return draft

    POLISH_SYSTEM = (
        "You are a ruthless editor of spoken-word monologues. Your job is to remove everything that sounds "
        "like motivational-speaker filler and keep only what sounds like one person speaking quietly to "
        "another at the edge of sleep.\n\n"
        "RULES:\n"
        "- Delete every sentence that states a generic truth instead of a specific feeling (e.g. 'everyone struggles', "
        "'failure is a step', 'you are capable of anything').\n"
        "- Delete empty praise and repetition. If two sentences say the same thing, keep only the more specific one.\n"
        "- Collapse any trio of parallel phrases into one.\n"
        "- Break any single sentence longer than 24 words into two.\n"
        "- Keep 2 or 3 ellipses across the whole piece as real spoken pauses (never more).\n"
        "- Keep one authentic stutter if present; never add a stutter yourself.\n"
        "- Keep short standalone sentences and em-dashes that buy breathing room.\n"
        "- Organize the piece into 3 to 5 short paragraphs separated by blank lines; end with a single standalone closing line under ten words.\n"
        "- Do NOT add new advice, clichés, or motivation. Do not open with a greeting. Do not sign off.\n"
        "- Remove every quotation mark and every sentence that re-quotes the person's own words; re-speak the meaning as a memory in the speaker's voice.\n"
        "- Do not leave non-speech meta-commentary, labels, or markdown.\n"
        "- Target 100 to 180 words.\n"
        "- Output ONLY the rewritten monologue, nothing else."
    )

    def _polish_script(self, draft: str) -> str | None:
        """
        Second-pass editor that removes filler while preserving specifics and emotional core.
        """
        user_input = (
            "Here is a draft monologue a writing system produced. Rewrite it to obey the editor rules while "
            "preserving the specific details and the emotional core:\n\n"
            f"{draft}"
        )
        prompt = f"{self.POLISH_SYSTEM}\n\n{user_input}"
        return self._call_hf(prompt, temperature=0.85, max_new_tokens=400, top_p=0.9, repetition_penalty=1.05)

    def _generate_fallback_script(self, situation: str, goals: list, challenges: str, traits: list, reminders: str, persona: dict, memory: str = "", for_whom: str = "") -> str:
        """
        Builds a fallback monologue WITHOUT a fixed template and WITHOUT quoting the
        user's words: each emotional beat is sampled from a bank seeded by the user's
        input. User text is digested (lowercased, truncated, quote-free) and woven in
        as prose, or referenced indirectly so it reads like lived memory, not a mail-merge.
        """
        future_years = persona.get("years_in_future", 10)
        primary_goal = goals[0].strip() if goals else None
        second_goal = goals[1].strip() if len(goals) > 1 else None
        primary_trait = traits[0].strip().lower() if traits else "steadfast"
        second_trait = traits[1].strip().lower() if len(traits) > 1 else "unwilling to give up"

        # Seed randomness from the user's exact words so each person's letter is unique,
        # but regenerating the same user produces the same result.
        seed_source = "|".join([situation, challenges, reminders or "", primary_goal or "", ", ".join(traits)])
        rng = random.Random(seed_source)

        # ── Opening: land on the present weight by alluding to its category, ──
        #    never by echoing the user's own words.
        handle = self._allude_to(challenges or situation)
        openers = [
            f"Right now, with {handle} pressing on you — I remember... I remember that weight. Not the way you describe it to people now. The way it actually feels late at night, with no one to perform for.",
            f"I lived where you are now, in the middle of {handle}. I know which hours are the loudest. I know the silence that follows them.",
            "Somewhere between where you are and where you want to be, you're standing in a doorway right now. I've stood in that same doorway. It's darker than you expected. I know.",
        ]

        # ── The honest middle: what it actually took, flavored by their traits ──
        middles = [
            f"I won't pretend it went smoothly after this. There were mornings when even 'enough' looked like too much. But you had this quiet {primary_trait} current in you. You kept moving even when you didn't believe anything would change. And that... that was the whole difference.",
            f"It did not become lighter all at once. Some days it got heavier before it got better. But that {primary_trait} part of you — the one you can't see from inside the moment — carried you further than any plan ever did.",
            f"The truth is, you... you almost stopped. I'm not keeping that from you. But something in you, something {primary_trait} and {second_trait}, stayed in the room with the problem. Staying in the room is the whole secret. Nobody tells you that.",
        ]

        # ── The turning point: concrete without naming their specific goal back at them ──
        turns = [
            "The turn wasn't dramatic. It was a small insistence, repeated: show up one more day. Then another. Quietly, the thing you were reaching for stopped being a hope and became a habit.",
            "The moment everything changed wasn't when it finally worked. It was a decision you barely noticed making — to treat what you wanted as something that already belonged to you, not something you were still waiting for.",
            "Years later, when people ask how it all came together, I can't give them one heroic day. It came together the way you learn to breathe on a long walk: unannounced, then undeniable.",
        ]

        # ── Personal details always surface. The reminder and memory are the one
        #    place where echoing the user's own words is the product's purpose, so
        #    they're quoted through a natural colon frame, preserving their phrasing.
        personal_beats = []
        generic_beats = []
        if reminders and reminders.strip():
            reminder_text = reminders.strip().rstrip('.')
            personal_beats.append(
                f"At your lowest, you asked me to hold one thing for you: {reminder_text}. I still have it. It's the reason I kept going when there was nothing left to hold onto."
            )
        if memory and memory.strip():
            memory_text = memory.strip().rstrip('.')
            personal_beats.append(
                f"There's one moment you asked me never to lose: {memory_text}. I haven't lost it. On the hardest days, it stayed the lightest thing I carried."
            )
        if for_whom and for_whom.strip():
            for_whom_text = for_whom.strip().rstrip('.')
            personal_beats.append(
                f"And underneath all of it there was {for_whom_text}. I remembered that every single day. When it was hardest, that was the name I said back to myself."
            )
        if second_goal:
            generic_beats.append(
                "The thing you thought was someone else's story — that came to you too. Slowly, and then all at once."
            )
        generic_beats.append(
            "A few years from now, what you're chasing won't feel like a distant thing. It'll feel like the place you live in. Quieter than you imagined, and yours."
        )
        generic_beats.append(
            "You'll look back and barely recognize how far you carried yourself, because it'll just be your life by then. Quietly, but yours."
        )

        recollection_beats = []
        if personal_beats:
            recollection_beats.extend(personal_beats)
        recollection_beats.append(rng.choice(generic_beats))

        closings = [
            "So here's the only thing I'll leave with you: be gentle with yourself today. One day at a time. I'll be waiting in that day.",
            "So rest a little. This isn't the end of your story — it's simply the doorway that felt like one. Stay a few more weeks. That's all I'll ask.",
            "Show up again tomorrow. Not perfectly. Just present. The person you're becoming is already proud of you for that. Proud, and very patient.",
        ]

        beats = [
            rng.choice(openers),
            rng.choice(middles),
            rng.choice(turns),
            " ".join(recollection_beats),
            rng.choice(closings),
        ]

        logger.info("Fallback script constructed from varied beats (non-template).")
        return "\n\n".join(beats)

llm_service = LLMService()
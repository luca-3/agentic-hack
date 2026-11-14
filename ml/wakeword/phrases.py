"""All texts and voices used to synthesize the wake word training data ("Hey Valo" / "Hey Daddy")."""

# Positives: plain text only. Gemini TTS sometimes speaks style prefixes ("Say casually: …") → never use them for positives.
POSITIVE = {
    "valo": ["Hey Valo", "Hey Valo!", "Hey, Valo.", "Hey Valo?", "hey valo", "Hey Valo.", "Hey... Valo", "Hey Vahlo"],
    "daddy": ["Hey Daddy", "Hey Daddy!", "Hey, Daddy.", "Hey Daddy?", "hey daddy", "Hey Daddy.", "Hey... Daddy"],
}

# Near misses the model must NOT fire on.
ADVERSARIAL = ["Hey Paolo", "Hey Waldo", "Hey Carlo", "Hello", "Hey Teddy", "Hey Danny", "Hey buddy", "Hey baby",
    "Halo", "Hey Google", "Hey Siri", "Alexa", "Okay", "Hey Lara", "Hey Daisy", "Hey Betty", "Hey Daniel",
    "Hey there", "Hey you", "Hallo", "Hey Paula", "Hey Willow", "Valentina", "Vale", "Halloween", "Daddy", "Valo", "Ciao"]

# Everyday office speech, English and German.
SENTENCES = [
    "Valo shows you where to click in web apps.", "With Valo, employees find features faster.",
    "Valo never clicks for you, it only points.", "Our product Valo listens for a wake word.",
    "Where can I change the bank details of a customer?", "Show me how to create an offer with a discount.",
    "How do I submit the offer for approval?", "I can't find the button to cancel the contract.",
    "Can you help me with the payment terms?", "Let's look at the insights dashboard together.",
    "The trainings are generated from employee questions.", "Fifty two people asked about the payment flow.",
    "This is the demo of our hackathon project.", "Thanks a lot, that was really helpful.",
    "My dad always says the same thing.", "The daily standup starts at nine.", "Hey everyone, welcome to our pitch.",
    "Wo kann ich die IBAN eines Kunden ändern?", "Zeig mir bitte, wie ich ein Angebot erstelle.",
    "Valo zeigt dir, wo du klicken musst.", "Hallo zusammen, schön dass ihr da seid.",
    "Ich finde den Knopf zum Kündigen nicht.", "Das Dashboard zeigt die wichtigsten Kennzahlen.",
    "Mein Papa hat gestern angerufen.", "Wir haben heute den ganzen Tag programmiert.",
    "Kannst du mir bei den Zahlungsbedingungen helfen?", "Okay, dann machen wir weiter mit der Demo.",
    "The weather in Karlsruhe is quite nice today.", "Please open the customer list and search for Müller.",
    "Hey, did you push the latest changes?", "Hey, wie geht's dir?", "Valo, Valo, Valo.",
]

# Hard negatives added after the first model fired on pitch sentences: "Valo" without "hey", "daddy" in other contexts.
HARD = [
    "Today we show you Valo.", "Valo helps your team find features faster.", "This is Valo, our assistant.",
    "Thank you for watching Valo.", "With Valo, nobody gets lost.", "Valo is voice native.", "We built Valo in one day.",
    "Let me introduce Valo.", "Valo points, it never clicks.", "So Valo noticed that I was stuck.", "Ask Valo anything.",
    "Valo learns from the questions.", "Das ist Valo, unser Assistent.", "Mit Valo findet jeder die Funktion.",
    "Valo hilft dir weiter.", "Wir zeigen euch heute Valo.", "Okay, Valo hat das erkannt.", "Say Valo and ask.",
    "Open the Valo dashboard.", "Here you see Valo in action.", "And now, Valo shows the button.", "You can ask Valo by voice.",
    "My daddy is here today.", "Who's your daddy?", "Daddy cool.", "They said daddy.", "Hey everyone, welcome.",
    "Hey there, nice to meet you.", "Hey, today we show you something new.", "Hey, look at this.", "Hey, that's Valo.",
]

# Style prefixes for negatives only (prosody variety; spoken prefixes are harmless there).
STYLES = ["", "Say casually: ", "Say quickly: ", "Say slowly and clearly: ", "Say with a German accent: ",
          "Say quietly: ", "Say excitedly: ", "Say in a tired voice: "]

GEMINI_VOICES = ("Zephyr Puck Charon Kore Fenrir Leda Orus Aoede Callirrhoe Autonoe Enceladus Iapetus Umbriel Algieba "
                 "Despina Erinome Algenib Rasalgethi Laomedeia Achernar Alnilam Schedar Gacrux Pulcherrima Achird "
                 "Zubenelgenubi Vindemiatrix Sadachbia Sadaltager Sulafat").split()
# Novelty macOS voices (bells, robots …) are used for negatives only.
MACOS_NOVELTY = {"Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Wobble", "Fred", "Good News",
                 "Jester", "Junior", "Organ", "Superstar", "Ralph", "Trinoids", "Zarvox", "Whisper", "Kathy"}

# Held-out voices for evaluation (features.py): the last 5 Gemini voices and the last macOS voices (sorted) are never
# seen by the eval model; the shipped model is then trained on everything with the same recipe.
VAL_GEMINI = 5
VAL_MACOS_REAL = 5
VAL_MACOS_ALL = 6

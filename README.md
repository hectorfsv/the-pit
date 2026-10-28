# The Pit

Hector's smoker app: the interface. A plan runs itself around the meat (the stall, the wrap, the rest, the hold); the
engine on n8n looks every two minutes and tells him in his chat; this page is the window on his phone, his desk tablet
and his Mac.

- `index.html`, `pit.css`, `pit.js`: the page. No build step. Open `index.html?demo` to walk through a sample cook.
- `engine/pit-engine.js`: a copy of the cook engine (the plan format, the rules, the alert switches). The page uses it to
  check a plan while you edit it and to name the alerts; the same file runs the cooks on n8n.
- `sample/`: two pretend cooks (made by the engine on a pretend smoker, not real cooks) and the plans, for the demo.
- `config.js`: the notebook's address and its publishable key. Public by design: the notebook's own rules decide who
  reads what, and sign-ups are off.
- `test/`: renders the page in real WebKit at the phone, tablet and desktop sizes and checks what is on screen.

The engine's tests, the notebook's schema, the smoker driver and the design notes live in Hephaestus's workspace, not
here. Nothing in this repo names the smoker's cloud identity, and nothing in it can move the smoker without the engine.

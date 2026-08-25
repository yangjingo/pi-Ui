# AIDA slide demo captures

The images in this directory are live-browser evidence for the AIDA slide deck. They show the single custom pet pack, `healing-whale-hit`, running through the official DSH Pet runtime.

With the local Web profile running at `http://127.0.0.1:3080`, refresh the proof set with:

```powershell
python .\docs\slides\demos\capture-pets.py
```

The script selects the whale, registers the bundled `aida-demo` Workspace, and captures the brand, Files, Trajectory, Canvas preview, and pet-detail states. It fails on browser console/page errors or if known private markers appear in the visible page text.

The bundled Workspace contains only public fixture content. Do not replace it with a personal Workspace when preparing a public release.

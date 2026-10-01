# fly — a fruit-fly connectome learns poker

Booth exhibit (a) for the club fair (`../CLUB-FAIR.md` §3.1). The wiring is the MaleCNS v1.0
connectome (166,700 neurons, CC-BY, FlyEM/Janelia + Cambridge + Google), frozen. Game state drives
its sensory neurons; a trained readout over its 1,316 descending neurons picks fold / call / raise.
The brain never changes — only how we listen to it does.

Controls: `shuffled` (same neurons and synapse counts, targets randomly rewired) and `nobrain`
(the same readout on the raw inputs). If the real fly doesn't beat the shuffled one, that's the result.

    uv sync && uv run python -m flypoker.data     # download feathers into data/ first (see flypoker/data.py)
    uv run pytest
    ./run.sh real                                 # resumable; also: shuffled, nobrain

# Stage 2 fixed inputs

`sgp.json` and `lcu.json` are independently shaped synthetic settlement/timeline responses,
created on 2026-10-19. SGP uses a json wrapper and flat participant statistics; LCU uses
participantIdentities plus nested stats. They contain no real identifiers or credentials.
These fixtures validate converters; they are not Windows or live-client verification.

`expected.json` is calculated by hand: (8+4)/2 = 6 KDA; (160+20)/30 = 6 CS/min;
12/20 = 0.6 participation; 20000/(20000+4*10000) = 1/3 damage share;
12000/(12000+4*10000) gold share; 10*(6+1) = 70 CS at 10;
500+10*300 = 3500 gold at 10; opponent 500+10*280 = 3300, difference 200;
2/30*10 = 2/3 deaths per 10. Four distinct item events share timestamp 120000.
Tests derive missing frames, invalid identity, unknown events and HTTP errors from these samples.
Hashes are recorded in the fixture manifest. Review expected values before changing versions.

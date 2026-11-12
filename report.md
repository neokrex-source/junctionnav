# Route lines against the map roads

No TomTom key here: OSRM routes, and OSRM routes drawn apart to stand for another map.

Metres to the nearest map road going the same way (every 5 m), and for lined-up lines also to the OSRM route.

| Trip | Line | km | to road: median | 95% | 99% | >3 m | to OSRM: median | 99% | max | >3 m | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| KLCC to KLIA | osrm | 61.6 | 0.1 | 0.5 | 2.6 | 0.8% |  |  |  |  |  |
| KLCC to KLIA | apart | 61.6 | 2.6 | 7.0 | 8.2 | 43.4% | 2.7 | 8.4 | 10.1 | 45.9% |  |
| KLCC to KLIA | apart-aligned | 61.6 | 0.0 | 0.1 | 0.2 | 0.0% | 0.1 | 5.0 | 8.3 | 1.8% | 179 |
| Mid Valley to Sunway | osrm | 11.2 | 0.1 | 0.4 | 0.6 | 0.0% |  |  |  |  |  |
| Mid Valley to Sunway | apart | 11.1 | 2.5 | 7.3 | 8.2 | 42.1% | 2.6 | 8.2 | 9.0 | 44.6% |  |
| Mid Valley to Sunway | apart-aligned | 11.2 | 0.0 | 0.1 | 0.2 | 0.0% | 0.1 | 0.7 | 2.6 | 0.0% | 50 |
| Bangsar South to Wangsa Maju | osrm | 17.1 | 0.1 | 0.5 | 1.3 | 0.1% |  |  |  |  |  |
| Bangsar South to Wangsa Maju | apart | 17.0 | 2.4 | 6.4 | 7.7 | 38.2% | 2.5 | 7.4 | 8.5 | 42.3% |  |
| Bangsar South to Wangsa Maju | apart-aligned | 17.1 | 0.0 | 0.1 | 0.2 | 0.2% | 0.1 | 3.3 | 7.2 | 1.2% | 66 |
| KL Sentral to Bukit Bintang | osrm | 4.9 | 0.1 | 0.5 | 0.6 | 0.1% |  |  |  |  |  |
| KL Sentral to Bukit Bintang | apart | 4.9 | 2.2 | 7.0 | 8.4 | 37.2% | 2.5 | 8.3 | 9.9 | 42.2% |  |
| KL Sentral to Bukit Bintang | apart-aligned | 4.9 | 0.0 | 0.1 | 0.3 | 0.0% | 0.1 | 0.6 | 0.8 | 0.0% | 36 |
| Putrajaya to Cyberjaya | osrm | 10.6 | 0.1 | 0.5 | 0.6 | 0.0% |  |  |  |  |  |
| Putrajaya to Cyberjaya | apart | 10.5 | 3.0 | 7.2 | 8.9 | 49.7% | 3.0 | 9.0 | 10.3 | 50.0% |  |
| Putrajaya to Cyberjaya | apart-aligned | 10.6 | 0.0 | 0.1 | 0.3 | 0.0% | 0.2 | 0.7 | 6.4 | 0.0% | 21 |
| UTP to Ipoh | osrm | 31.7 | 0.1 | 0.4 | 0.6 | 0.0% |  |  |  |  |  |
| UTP to Ipoh | apart | 31.8 | 2.5 | 6.6 | 7.7 | 42.9% | 2.6 | 7.7 | 9.2 | 43.8% |  |
| UTP to Ipoh | apart-aligned | 31.7 | 0.0 | 0.1 | 0.2 | 0.0% | 0.1 | 0.7 | 9.6 | 0.1% | 64 |
| Ampang to Cheras | osrm | 14.0 | 0.1 | 0.4 | 0.6 | 0.1% |  |  |  |  |  |
| Ampang to Cheras | apart | 13.9 | 2.5 | 7.2 | 8.3 | 40.4% | 2.8 | 8.2 | 11.4 | 46.3% |  |
| Ampang to Cheras | apart-aligned | 14.0 | 0.0 | 0.1 | 0.2 | 0.0% | 0.1 | 4.5 | 8.9 | 1.4% | 43 |
| Damansara to Kepong | osrm | 11.1 | 0.1 | 0.4 | 0.5 | 0.0% |  |  |  |  |  |
| Damansara to Kepong | apart | 11.1 | 2.7 | 6.7 | 7.8 | 45.4% | 2.8 | 7.9 | 9.1 | 46.9% |  |
| Damansara to Kepong | apart-aligned | 11.1 | 0.0 | 0.1 | 0.2 | 0.1% | 0.1 | 0.5 | 0.7 | 0.0% | 40 |
| Shah Alam to Klang | osrm | 12.0 | 0.1 | 0.4 | 0.6 | 0.0% |  |  |  |  |  |
| Shah Alam to Klang | apart | 12.0 | 2.4 | 6.7 | 7.6 | 41.6% | 2.5 | 7.9 | 9.4 | 43.5% |  |
| Shah Alam to Klang | apart-aligned | 12.0 | 0.0 | 0.1 | 0.2 | 0.0% | 0.1 | 0.6 | 2.7 | 0.0% | 37 |
| Jalan Duta to Sungai Buloh | osrm | 15.0 | 0.1 | 0.4 | 0.5 | 0.0% |  |  |  |  |  |
| Jalan Duta to Sungai Buloh | apart | 15.0 | 2.3 | 6.7 | 8.2 | 38.4% | 2.8 | 8.4 | 9.3 | 46.1% |  |
| Jalan Duta to Sungai Buloh | apart-aligned | 15.0 | 0.0 | 0.1 | 0.2 | 0.0% | 0.1 | 0.5 | 1.0 | 0.0% | 48 |

Road tiles fetched: 88, 12.2 MB. Jumps in lined-up lines: 2.

## Worst stretches

- KLCC to KLIA, osrm: 320 m more than 3 m off (mean 4.4 m) at 3.12903,101.71287
- KLCC to KLIA, apart: 365 m more than 3 m off (mean 5.6 m) at 3.12861,101.71256
- KLCC to KLIA, apart-aligned: 265 m more than 3 m off (mean 6.4 m) at 3.13348,101.71669
- KLCC to KLIA, apart-aligned: 250 m more than 3 m off (mean 6.0 m) at 3.14925,101.72308
- KLCC to KLIA, apart-aligned: 330 m more than 3 m off (mean 4.4 m) at 3.12910,101.71286
- Mid Valley to Sunway, apart: 330 m more than 3 m off (mean 5.6 m) at 3.08498,101.62200
- Bangsar South to Wangsa Maju, osrm: 25 m more than 3 m off (mean 3.4 m) at 3.20115,101.71894
- Bangsar South to Wangsa Maju, apart: 170 m more than 3 m off (mean 5.3 m) at 3.19474,101.71159
- Bangsar South to Wangsa Maju, apart-aligned: 75 m more than 3 m off (mean 5.6 m) at 3.18205,101.70173
- Bangsar South to Wangsa Maju, apart-aligned: 75 m more than 3 m off (mean 5.4 m) at 3.17804,101.70017
- Bangsar South to Wangsa Maju, apart-aligned: 25 m more than 3 m off (mean 4.2 m) at 3.13489,101.68474
- KL Sentral to Bukit Bintang, apart: 160 m more than 3 m off (mean 6.4 m) at 3.13177,101.68632
- Putrajaya to Cyberjaya, apart: 325 m more than 3 m off (mean 5.4 m) at 2.92981,101.66168
- UTP to Ipoh, apart: 170 m more than 3 m off (mean 6.6 m) at 4.46289,100.99637
- UTP to Ipoh, apart-aligned: 40 m more than 3 m off (mean 5.6 m) at 4.56613,101.04863
- Ampang to Cheras, apart: 180 m more than 3 m off (mean 5.9 m) at 3.15802,101.75576
- Ampang to Cheras, apart-aligned: 140 m more than 3 m off (mean 6.8 m) at 3.13408,101.77938
- Ampang to Cheras, apart-aligned: 50 m more than 3 m off (mean 4.0 m) at 3.14339,101.77573
- Damansara to Kepong, apart: 150 m more than 3 m off (mean 6.6 m) at 3.21246,101.63179
- Shah Alam to Klang, apart: 180 m more than 3 m off (mean 5.9 m) at 3.06299,101.50906
- Jalan Duta to Sungai Buloh, apart: 115 m more than 3 m off (mean 10.5 m) at 3.18333,101.66097

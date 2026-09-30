/* THE PLANNING EXAM — 10 cities, planned by Trip Vault's own planner with live internet data, scored automatically.
   `must`: the answer key — the sights any good 4-day plan includes (written by hand from travel knowledge; used only
   to mark the plan, never given to the planner). A name matches when either contains the other.
   Run: node test/exam/cities.run.js [City] */
module.exports = [
  {city: 'Dubai', country: 'United Arab Emirates', hotel: 'Grand Excelsior Hotel Bur Dubai', must: ['Burj Khalifa', 'Dubai Mall', 'Dubai Museum|Al Fahidi', 'Gold Souk|Spice Souk', 'Dubai Frame|Palm Jumeirah|Burj al-Arab|Jumeirah Mosque']},
  {city: 'Singapore', country: 'Singapore', hotel: 'Marina Bay Sands', must: ['Gardens by the Bay', 'Merlion', 'Sentosa|Universal Studios', 'Botanic Gardens', 'Chinatown|Buddha Tooth|Little India|Sri Mariamman']},
  {city: 'Bangkok', country: 'Thailand', hotel: 'Shangri-La Hotel Bangkok', must: ['Grand Palace|Wat Phra Kaew', 'Wat Pho|Chetuphon|Reclining Buddha', 'Wat Arun|Temple of Dawn', 'Chatuchak|Jim Thompson', 'Chinatown|Yaowarat|Asiatique|Lumphini']},
  {city: 'Paris', country: 'France', hotel: 'Hotel Regina Louvre', must: ['Eiffel Tower|Tour Eiffel', 'Louvre', 'Notre-Dame|Notre Dame|Sainte-Chapelle', "Arc de Triomphe", "Sacré-Cœur|Sacre-Coeur|Montmartre|Orsay"]},
  {city: 'London', country: 'United Kingdom', hotel: 'Strand Palace Hotel', must: ['British Museum', 'Tower of London|Tower Bridge', 'Westminster Abbey|Elizabeth Tower|Big Ben|Houses of Parliament', 'National Gallery|Trafalgar', 'Buckingham Palace|St Paul']},
  {city: 'Istanbul', country: 'Turkey', hotel: 'Pera Palace Hotel', must: ['Hagia Sophia', 'Blue Mosque|Sultan Ahmed|Sultanahmet Mosque', 'Topkapı|Topkapi', 'Grand Bazaar|Spice Bazaar|Egyptian Bazaar', 'Basilica Cistern|Galata Tower']},
  {city: 'Jaipur', country: 'India', hotel: 'Rambagh Palace', must: ['Amber Fort|Amer Fort', 'Hawa Mahal', 'City Palace', 'Jantar Mantar', 'Nahargarh|Jal Mahal|Albert Hall']},
  {city: 'Goa', country: 'India', hotel: 'Taj Fort Aguada Resort Candolim', must: ['Fort Aguada|Aguada', 'Bom Jesus|Old Goa|Se Cathedral', 'Calangute|Baga|Candolim Beach', 'Anjuna|Chapora|Vagator', 'Fontainhas|Panjim|Panaji|Dona Paula|Miramar']},
  {city: 'Tokyo', country: 'Japan', hotel: 'Park Hyatt Tokyo', must: ['Senso-ji|Sensō-ji|Asakusa', 'Meiji Shrine|Meiji Jingu', 'Shibuya Crossing|Hachikō|Hachiko', 'Skytree|Tokyo Tower', 'Imperial Palace|Shinjuku Gyoen|Ueno']},
  {city: 'Rome', country: 'Italy', hotel: 'Hotel Artemide Rome', must: ['Colosseum|Colosseo', 'Pantheon', 'Trevi', 'Vatican|St. Peter|Sistine', 'Roman Forum|Forum|Palatine|Spanish Steps']},
];

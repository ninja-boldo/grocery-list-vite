from pymilvus import MilvusClient
from sentence_transformers import SentenceTransformer

client = MilvusClient("milvus_demo.db")

docs = [
    # History
    "The Roman Empire reached its greatest territorial extent under Emperor Trajan in 117 AD.",
    "The Great Fire of London destroyed large parts of the city in 1666.",
    "Cleopatra VII was the last active ruler of the Ptolemaic Kingdom of Egypt.",
    "World War II ended in 1945 with the surrender of Germany and Japan.",
    "The Berlin Wall fell in 1989, marking the end of the Cold War.",
    "The French Revolution began in 1789 and overthrew the monarchy.",
    "The American Civil War lasted from 1861 to 1865.",
    "Genghis Khan founded the Mongol Empire in the 13th century.",
    "The Declaration of Independence was signed in 1776.",
    "The Renaissance was a cultural movement that began in Italy in the 14th century.",

    # Astronomy
    "The Milky Way is a barred spiral galaxy containing our Solar System.",
    "Black holes are regions of spacetime where gravity is so strong that nothing can escape.",
    "Jupiter has at least 79 known moons, the largest being Ganymede.",
    "Saturn is famous for its system of rings composed of ice and rock.",
    "A supernova occurs when a massive star explodes at the end of its life cycle.",
    "The Andromeda Galaxy is the closest spiral galaxy to the Milky Way.",
    "Mars is known as the Red Planet because of iron oxide on its surface.",
    "The Sun is a G-type main-sequence star located at the center of our Solar System.",
    "Neutron stars are incredibly dense remnants of supernova explosions.",
    "The Hubble Space Telescope was launched in 1990 and still operates today.",

    # Computer Science
    "Python is a high-level programming language known for its readability.",
    "The C programming language was developed by Dennis Ritchie in the 1970s.",
    "A binary search algorithm finds the position of a target value within a sorted array.",
    "JavaScript is widely used for web development.",
    "Databases can be relational or non-relational.",
    "Machine learning is a subset of artificial intelligence.",
    "Sorting algorithms include quicksort, mergesort, and bubble sort.",
    "Operating systems manage hardware and software resources.",  # This should match!
    "Git is a version control system created by Linus Torvalds.",
    "Big O notation describes algorithmic complexity.",

    # Sports
    "Lionel Messi has won the Ballon d'Or multiple times.",
    "The Olympic Games are held every four years.",
    "Tennis is played either as singles or doubles.",
    "Basketball was invented by James Naismith in 1891.",
    "The FIFA World Cup is the most watched sporting event globally.",
    "Michael Jordan is considered one of the greatest basketball players of all time.",
    "The Tour de France is a famous cycling competition.",
    "Cricket is especially popular in India, England, and Australia.",
    "Baseball is known as America's pastime.",
    "The Super Bowl is the championship game of the NFL.",

    # Music
    "The Beatles were an English rock band formed in Liverpool in 1960.",
    "Classical music often features orchestras with strings, woodwinds, brass, and percussion.",
    "Hip hop originated in the Bronx, New York City, during the 1970s.",
    "Jazz developed in the early 20th century in the United States.",
    "Beethoven composed nine symphonies.",
    "Elvis Presley was called the King of Rock and Roll.",
    "Reggae originated in Jamaica in the late 1960s.",
    "K-pop is a popular music genre from South Korea.",
    "The violin is a common instrument in classical and folk music.",
    "Electronic dance music is often played at festivals and clubs.",

    # Geography
    "Mount Everest is the highest mountain on Earth.",
    "The Amazon River is the second longest river in the world.",
    "The Sahara is the largest hot desert on the planet.",
    "Tokyo is the most populous metropolitan area in the world.",
    "Antarctica is the coldest continent.",
    "The Nile River flows through northeastern Africa.",
    "Greenland is the world's largest island.",
    "The Great Barrier Reef is located off the coast of Australia.",
    "The Alps are a mountain range in Europe.",
    "The Pacific Ocean is the largest ocean on Earth.",

    # Biology
    "DNA carries genetic information in living organisms.",
    "Photosynthesis is the process by which plants produce energy.",
    "The human brain contains around 86 billion neurons.",
    "Mitochondria are known as the powerhouses of the cell.",
    "Charles Darwin proposed the theory of natural selection.",
    "The circulatory system transports blood and nutrients.",
    "Ants are social insects that live in colonies.",
    "The human skeleton has 206 bones.",
    "Viruses require a host cell to reproduce.",
    "Proteins are made of chains of amino acids.",

    # Literature
    "William Shakespeare wrote Romeo and Juliet.",
    "George Orwell is the author of 1984.",
    "Homer is traditionally said to have written the Iliad and the Odyssey.",
    "Moby-Dick was written by Herman Melville.",
    "Pride and Prejudice is a novel by Jane Austen.",
    "The Divine Comedy was written by Dante Alighieri.",
    "The Brothers Grimm collected and published folktales.",
    "J.K. Rowling is the author of the Harry Potter series.",
    "The Catcher in the Rye was written by J.D. Salinger.",
    "War and Peace was written by Leo Tolstoy.",

    # Technology
    "The first iPhone was released in 2007.",
    "The Internet originated from ARPANET in the late 1960s.",
    "Cloud computing provides on-demand computing services.",
    "Blockchain is the technology underlying cryptocurrencies.",
    "5G is the fifth generation of mobile network technology.",
    "Artificial neural networks are inspired by the human brain.",
    "Quantum computing uses qubits instead of bits.",
    "Virtual reality immerses users in a digital environment.",
    "3D printing creates physical objects from digital models.",
    "Self-driving cars use sensors and AI to navigate."
]

# SBERT model
sbert_model = SentenceTransformer('sentence-transformers/all-mpnet-base-v2')

# Drop and recreate collection to ensure clean state
if client.has_collection("demo_collection"):
    client.drop_collection("demo_collection")

# Create collection with explicit parameters
client.create_collection(
    "demo_collection", 
    dimension=768,  # all-mpnet-base-v2 produces 768-dim vectors
    metric_type="COSINE"  # Explicitly set cosine similarity
)

# Encode documents
vectors = sbert_model.encode(docs).tolist()

# Insert data
data = [{"id": i, "vector": vectors[i], "text": docs[i]} for i in range(len(vectors))]
client.insert("demo_collection", data)

# Load collection for searching
client.load_collection("demo_collection")

# Test queries
test_queries = [
    "operating system hardware management",
    "i manage hardware as does the os",
    "systems that control computer hardware",
    "black holes and space", 
    "databases often are relational but also can be non relational"
]

print("Testing different queries:")
for query in test_queries:
    print(f"\nQuery: '{query}'")
    query_vector = sbert_model.encode([query]).tolist()
    print(f"the vector of this query: '{query}' is this: '{query_vector}'")
    
    results = client.search(
        collection_name="demo_collection",
        data=query_vector,
        output_fields=["text"],
        limit=3
    )
    
    for i, result in enumerate(results[0]):
        print(f"  {i+1}. (distance: {result['distance']:.4f}) {result['entity']['text']}")
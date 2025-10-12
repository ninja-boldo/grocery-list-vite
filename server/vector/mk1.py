import ollama
from pymilvus import MilvusClient
from typing import List, Dict, Any

#   nomic-embed-text
#   bge-m3
#   jina/jina-embeddings-v2-base-de
class VectorSearchSystem:
    def __init__(self, db_path: str = "vector_search.db", model_name: str = "jina/jina-embeddings-v2-base-de"):
        """Initialize the vector search system"""
        self.client = MilvusClient(db_path)
        self.model_name = model_name
        self.collection_name = "documents"
        
    def embed_text(self, text: str | List[str]) -> List[List[float]]:
        """Get embeddings for text"""
        if isinstance(text, str):
            text = [text]
        
        response = ollama.embed(model=self.model_name, input=text)
        return response['embeddings']
    
    def create_collection(self, documents: List[str], force_recreate: bool = False):
        """Create and populate the vector collection"""
        
        if self.client.has_collection(self.collection_name):
            if force_recreate:
                self.client.drop_collection(self.collection_name)
                print(f"✓ Dropped existing collection '{self.collection_name}'")
            else:
                print(f"✓ Collection '{self.collection_name}' already exists")
                return
        
        # Get embeddings for all documents
        print(f"🔄 Generating embeddings for {len(documents)} documents...")
        embeddings = self.embed_text(documents)
        dim = len(embeddings[0])
        
        # Create collection with optimal settings
        self.client.create_collection(
            self.collection_name, 
            dimension=dim, 
            metric_type="COSINE",  
            auto_id=False
        )
        
        # Prepare data for insertion
        data = []
        for i, (doc, embedding) in enumerate(zip(documents, embeddings)):
            data.append({
                "id": i,
                "vector": embedding,
                "text": doc
            })
        
        # Insert data
        self.client.insert(self.collection_name, data)
        self.client.load_collection(self.collection_name)
        
        print(f"✓ Created collection with {len(documents)} documents (dim={dim})")
    
    def search(self, query: str, top_k: int = 5, min_score: float = 0.0) -> List[Dict[str, Any]]:
        """Search for similar documents"""
        
        # Get query embedding
        query_embedding = self.embed_text(query)
        
        # Search
        results = self.client.search(
            collection_name=self.collection_name,
            data=query_embedding,
            output_fields=["text"],
            limit=top_k
        )
        
        # Format results
        formatted_results = []
        for result in results[0]:
            score = result["distance"]
            # Skip results below minimum score threshold
            if score < min_score:
                continue
                
            formatted_results.append({
                "text": result["entity"]["text"],
                "score": score,
                "id": result["id"]
            })
        
        return formatted_results
    
    def print_search_results(self, query: str, results: List[Dict[str, Any]]):
        """Pretty print search results"""
        print(f"\n🔍 Query: '{query}'")
        print("-" * 80)
        
        if not results:
            print("   No results found.")
            return
        
        for i, result in enumerate(results, 1):
            score = result["score"]
            text = result["text"]
            
            # Add score interpretation
            if score > 0.85:
                quality = "🟢 Excellent"
            elif score > 0.75:
                quality = "🟡 Good"
            elif score > 0.65:
                quality = "🟠 Fair"
            else:
                quality = "🔴 Poor"
            
            print(f"   {i}. {quality} (Score: {score:.4f})")
            print(f"      {text}")
            print()

def get_curated_documents():
    """Get a curated set of documents without problematic entries"""
    
    return [
        # History
        "The Roman Empire reached its greatest territorial extent under Emperor Trajan in 117 AD.",
        "World War II ended in 1945 with the surrender of Germany and Japan.",
        "The Berlin Wall fell in 1989, marking the end of the Cold War.",
        "The Declaration of Independence was signed in 1776.",
        "The French Revolution began in 1789 and overthrew the monarchy.",
        
        # Astronomy & Space
        "The Milky Way is a barred spiral galaxy containing our Solar System.",
        "Jupiter has at least 79 known moons, the largest being Ganymede.",
        "Saturn is famous for its system of rings composed of ice and rock.",
        "Mars is known as the Red Planet because of iron oxide on its surface.",
        "Black holes are regions of spacetime where gravity prevents escape.",
        "The Hubble Space Telescope has revolutionized our understanding of the universe.",
        
        # Computer Science & Technology
        "Python is a high-level programming language known for its readability.",
        "JavaScript is widely used for web development and user interfaces.",
        "Machine learning is a subset of artificial intelligence.",
        "Operating systems manage hardware and software resources.",
        "Git is a version control system for tracking code changes.",
        "Cloud computing provides scalable on-demand computing resources.",
        
        # Music & Arts
        "The Beatles were an English rock band formed in Liverpool in 1960.",
        "Jazz developed in the early 20th century in the United States.",
        "Beethoven composed nine symphonies during his lifetime.",
        "Hip hop originated in the Bronx during the 1970s.",
        
        # Sports
        "Basketball was invented by James Naismith in 1891.",
        "The FIFA World Cup is the most watched sporting event globally.",
        "The Olympic Games bring together athletes from around the world.",
        
        # Science & Nature
        "DNA carries genetic information in all living organisms.",
        "Photosynthesis allows plants to convert sunlight into energy.",
        "The human brain contains approximately 86 billion neurons.",
        "Charles Darwin proposed the theory of evolution by natural selection.",
        "pflaumen",
        "kirschen",
        "kartoffeln"
    ]

def run_comprehensive_tests(search_system: VectorSearchSystem):
    """Run comprehensive search tests"""
    
    test_cases = [
        # Should find Roman Empire
        "ancient Rome conquered territories empire Trajan",
        # Should find Jupiter/space content  
        "planets moons Jupiter astronomy space",
        # Should find Python programming
        "Python programming language readable code",
        # Should find Beatles music
        "Beatles rock band Liverpool music",
        # Should find DNA/biology
        "DNA genetic information biology life",
        # Should find World War II
        "World War Two 1945 Germany Japan",
        # Should find basketball sports
        "basketball sports James Naismith invented"
    ]
    
    print("="*80)
    print("COMPREHENSIVE SEARCH QUALITY TEST")
    print("="*80)
    
    for query in test_cases:
        results = search_system.search(query, top_k=3, min_score=0.6)
        search_system.print_search_results(query, results)

def interactive_search(search_system: VectorSearchSystem):
    """Interactive search interface"""
    
    print("="*80)
    print("INTERACTIVE VECTOR SEARCH")
    print("Type 'quit' or 'exit' to stop")
    print("="*80)
    
    while True:
        try:
            query = input("\n🔍 Enter search query: ").strip()
            
            if query.lower() in ['quit', 'exit', '']:
                break
            
            results = search_system.search(query, top_k=5)
            search_system.print_search_results(query, results)
            
        except KeyboardInterrupt:
            break
    
    print("\n👋 Thanks for using Vector Search!")

def main():
    """Main function"""
    
    # Initialize system
    print("🚀 Initializing Vector Search System...")
    search_system = VectorSearchSystem()
    
    # Get documents
    documents = get_curated_documents()
    
    # Create collection
    search_system.create_collection(documents, force_recreate=True)
    
    # Run tests
    run_comprehensive_tests(search_system)
    
    # Start interactive search
    interactive_search(search_system)

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Audit your dependencies to find what's actually used
Run: python audit_deps.py /path/to/server
"""

import ast
import os
import sys
from pathlib import Path
from collections import defaultdict

def find_imports(file_path):
    """Extract all imports from a Python file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            tree = ast.parse(f.read())
        
        imports = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imports.add(alias.name.split('.')[0])
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    imports.add(node.module.split('.')[0])
        return imports
    except:
        return set()

def scan_directory(directory):
    """Scan all Python files in directory"""
    all_imports = set()
    
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.py'):
                file_path = os.path.join(root, file)
                imports = find_imports(file_path)
                all_imports.update(imports)
    
    return all_imports

def read_requirements(req_file):
    """Parse requirements.txt"""
    packages = []
    with open(req_file, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                pkg = line.split('==')[0].split('>=')[0].split('<=')[0]
                packages.append(pkg.lower().replace('_', '-'))
    return packages

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python audit_deps.py <server_directory>")
        sys.exit(1)
    
    server_dir = sys.argv[1]
    used_imports = scan_directory(server_dir)
    
    print("=== IMPORTS FOUND IN CODE ===")
    for imp in sorted(used_imports):
        print(f"  - {imp}")
    
    # Read requirements
    if os.path.exists('requirements.txt'):
        required_packages = read_requirements('requirements.txt')
        
        print("\n=== POTENTIALLY UNUSED PACKAGES ===")
        # This is approximate - some packages have different import names
        used_lower = {imp.lower().replace('_', '-') for imp in used_imports}
        
        unused = []
        for pkg in required_packages:
            # Simple heuristic
            if not any(pkg.startswith(u) or u.startswith(pkg) for u in used_lower):
                unused.append(pkg)
        
        for pkg in sorted(unused):
            print(f"  - {pkg}")
        
        print(f"\nTotal packages: {len(required_packages)}")
        print(f"Potentially unused: {len(unused)}")

# COMMON PACKAGES TO QUESTION:
suspicious_packages = {
    'selenium': 'Web scraping - needed?',
    'kubernetes': 'K8s client - running in k8s?',
    'matplotlib': 'Plotting - used in production?',
    'jupyter': 'Development only?',
    'pandas': 'Can you use lighter alternatives?',
    'scikit-learn': 'Do you need full sklearn?',
}

print("\n=== PACKAGES TO REVIEW ===")
for pkg, question in suspicious_packages.items():
    print(f"  - {pkg}: {question}")
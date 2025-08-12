def calc(n):
    return ( ((-1) ** n) / (2 * n + 1) )


res = 0
iterations = 1_000_000_0
for i in range(iterations):
    res += calc(i)
    
print(f"the res after {iterations} iterations is: {4 * res}")
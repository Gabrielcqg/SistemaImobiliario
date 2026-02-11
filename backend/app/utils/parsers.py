import re
from typing import Optional

def parse_ptbr_recency(text: str) -> Optional[int]:
    """
    Parses PT-BR recency strings into number of days.
    Examples:
    - "Publicado hoje" -> 0
    - "Publicado ontem" -> 1
    - "Publicado há 2 dias" -> 2
    - "Publicado há 3 horas" -> 0
    - "Publicado há 1 semana" -> 7
    - "Publicado há 2 semanas" -> 14
    - "Publicado há 1 mês" -> 30
    - "Publicado há 1 ano" -> 365
    Returns None if unparseable.
    """
    if not text:
        return None
        
    text = text.lower().strip()
    
    # Ignore "atualizado" if we are strictly looking for "publicado"
    # The user instruction says: "extrair sempre o Publicado há X"
    # But usually this function receives just the time string "há X dias"
    # If the input is "Publicado há 1 ano, atualizado há 11 horas", we expect the caller 
    # to pass the specific capturing group, BUT let's be robust if we get the full string.
    
    # If text contains "publicado", prioritize that part
    if "publicado" in text and "atualizado" in text:
        # Split and take the part before "atualizado" or specifically "publicado..."
        parts = text.split("atualizado")
        text = parts[0]

    # Normalized conversions
    val = 0
    
    # Direct matches
    if "hoje" in text or "agora" in text:
        return 0
    if "ontem" in text:
        return 1
        
    # Helper to extract number (digit or 'um/uma')
    def extract_number(s):
        match = re.search(r"(\d+)", s)
        if match: return int(match.group(1))
        if "um" in s or "uma" in s: return 1
        return 0

    # Years
    if "ano" in text:
        return extract_number(text) * 365
        
    # Months
    if "mê" in text: # mês, meses
        return extract_number(text) * 30
        
    # Weeks
    if "semana" in text:
        return extract_number(text) * 7
        
    # Days
    if "dia" in text:
        return extract_number(text)

    # Hours/Minutes -> 0 days
    if "hora" in text or "minuto" in text:
        return 0

    # Fallback regex "há X ..." if units were missed matches but structure exists
    match_num = re.search(r"há\s+(\d+)", text)
    if match_num:
        # Default to days if no unit found? Unlikely, but let's assume raw number is days
        return int(match_num.group(1))

    return None

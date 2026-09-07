// Conversion en booléen. 
// La donnée Darwin est du XML/JSON hétérogène : certains champs portent un
// booléen natif, d'autres la chaîne "true"/"false".

/** Vrai si et seulement si la valeur est le booléen `true` ou la chaîne `"true"`. */
export function toBoolean(value: unknown): boolean {
	return value === true || value === "true";
}

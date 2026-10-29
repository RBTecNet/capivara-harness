import { explicitModes, normalize } from './authority.js';

const applicationModeFact=/^(?:interface(?: da aplicacao| do aplicativo| do produto)?|modalidade(?: da aplicacao| da interface)?|application[ -]?mode|tipo de (?:interface|aplicacao))$/;
const storageProviderFact=/^(?:(?:tipo|tecnologia|mecanismo|provedor|formato|meio|opcao) (?:de|do|da) )?(?:persistencia(?: (?:de|dos) dados)?|armazenamento(?: (?:de|dos) dados)?|storage(?: (?:choice|provider|technology))?|tipo de banco|banco(?: de dados)?|database(?: choice)?)$/;
const database='(?:sqlite|postgres(?:ql)?|mysql|mongodb)';
const storage=`(?:json|${database})`;
const explicitStorageChoices=[
  new RegExp(`\\b(?:persistencia|armazenamento|storage|banco(?: de dados)?|database)\\s*(?:(?:em|com|via|in|using)\\s*|[:=-]\\s*)?${storage}\\b`,'g'),
  new RegExp(`\\b(?:persistir|armazenar|armazenado[s]?|salvar|gravar|persist|store|save)\\s+(?:(?:os|the|all)\\s+)?(?:dados|registros|data|records)\\s+(?:em|in|using)\\s+${storage}\\b`,'g'),
  new RegExp(`\\b(?:usar|use|utilizar|utilize|usando|using|com|with)\\s+(?:(?:o|a|the)\\s+)?${database}\\b`,'g'),
  new RegExp(`^(?:[-*]\\s*)?${database}(?:\\s+em arquivo)?[.:]?$`,'gm'),
  /\bsem persistencia(?: de dados)?\s*(?=[.;\n]|$)/g,
];

function storageSpecified(authority:string):boolean{
  for(const pattern of explicitStorageChoices){
    pattern.lastIndex=0;
    for(const match of authority.matchAll(pattern)){
      const prefix=authority.slice(Math.max(0,match.index-50),match.index);
      if(/\b(?:nao|sem|not|without|avoid|evitar)\s+(?:(?:usar|use|utilizar|queremos|quero|want|adotar)\s+)?$/.test(prefix))continue;
      return true;
    }
  }
  return false;
}

/** Resolve the specific product decision, never another decision that merely
 * mentions the same word (retention/storage or integration/application UI). */
export function choiceAlreadySpecified(fact:string,category:string,authority:string,question=''):boolean{
  const subject=normalize(fact),source=normalize(authority);
  const applicationAxis=/\b(?:modalidade|application|aplicacao|aplicativo|produto)\b/.test(subject)||explicitModes(question).length>0||/\b(?:aplicacao|aplicativo|application|product)\b/.test(normalize(question));
  if(category!=='integration'&&applicationAxis&&applicationModeFact.test(subject)&&explicitModes(source).length>0)return true;
  return storageProviderFact.test(subject)&&storageSpecified(source);
}

export function engineeringChoiceQuestion(question:string):boolean{
  const text=normalize(question);
  if(/\b(?:npm ci|npm install)\b/.test(text))return true;
  if(/^(?:qual|quais|which|what)\s+(?:(?:a|o|the)\s+)?(?:biblioteca|framework|linguagem|stack|banco de dados|orm|library|language|database)\b/.test(text))return true;
  return/\b(?:prefere|prefer|escolher|choose)\b.{0,60}\b(?:bootstrap|tailwind|framework|orm)\b/.test(text);
}

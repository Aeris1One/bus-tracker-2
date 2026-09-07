# @bus-tracker/processor-darwin

Provider Bus Tracker pour **National Rail**, le réseau ferroviaire du Royaume-Uni.
Nécessite un bucket GCS sur lequel est copié les [fiches horaires théoriques](https://raildata.org.uk/dashboard/dataProduct/P-9ca6bc7e-62e1-44d6-b93a-1616f7d2caf8/overview) de Darwin et les identifiants pour le flux [PushPort](https://raildata.org.uk/dataProduct/P-3f10bf96-d8e8-4041-aa5e-d75d82c45c4e/overview).

## Lancer en développement

Prérequis : Node.js 26.7.0 ou plus, `corepack enable`, et un Redis accessible (`docker compose up
-d` à la racine du dépôt). Le paquet `@bus-tracker/contracts` doit être compilé au moins une fois :

```bash
pnpm -C libraries/contracts build
```

Renseignez ensuite les identifiants Kafka et l'accès au bucket dans votre environnement, puis :

```bash
pnpm dev:darwin configurations/national-rail.mjs
```

L'argument positionnel est le chemin vers un fichier de configuration, en pratique
ça sera presque toujours `configurations/national-rail.mjs` mais vu que j'ai copié la structure du
provider GTFS, on une gestion des configurations ;)

## Variables d'environnement

| Variable | Défaut | Effet |
|---|---|---|
| `REDIS_URL` | `redis://127.0.0.1:6379` | Adresse Redis (TCP). |
| `REDIS_SOCK` | — | Si définie, connexion par socket Unix ; `REDIS_URL` est alors ignorée. |
| `REDIS_TLS` | `false` | TLS sur le socket Unix (`"true"` seulement). |
| `REDIS_CHANNEL` | `journeys` | Canal de publication. |
| `DARWIN_KAFKA_BROKERS` | — | Liste de brokers séparés par des virgules. |
| `DARWIN_KAFKA_GROUP_ID` | — | Groupe de consommation, imposé par ACL côté fournisseur. |
| `DARWIN_KAFKA_SASL_USERNAME` | — | Identifiant SASL/PLAIN. |
| `DARWIN_KAFKA_SASL_PASSWORD` | — | Mot de passe SASL/PLAIN. |
| `DARWIN_KAFKA_CLIENT_ID` | `bus-tracker-darwin` | Identifiant client Kafka. |
| `DATA_DIR` | `/data` | Répertoire de cache disque (graphes ferroviaires, tracés précalculés). |
| `RAILWAY_GRAPH_PATH` | — | Chemin local forçant le fichier de graphe ferroviaire. |
| `RAILWAY_CH_PATH` | — | Chemin local forçant le fichier de graphe pré-contracté. |
| `RAILEASY_TIPLOCS_PATH` | — | Chemin local forçant le fichier de coordonnées. |
| `POSTHOG_KEY` | — | Active la remontée d'exceptions ; sans elle, la télémétrie est inerte. |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Chemin du fichier d'identifiants du compte de service d'accès au bucket. |

En complément, l'adresse Redis peut aussi être fournie en ligne de commande via `--redis-url`
(valeur par défaut : `REDIS_URL`).

## Image Docker

```bash
# Depuis la racine du dépôt : le paquet dépend de @bus-tracker/contracts et
# @bus-tracker/monitoring en workspace:*, qui doivent être compilés dans la même construction.
docker build -f providers/darwin/Dockerfile -t bus-tracker-darwin .

docker run --rm \
  -v darwin-data:/data \
  -e REDIS_URL=redis://redis:6379 \
  bus-tracker-darwin /etc/darwin/national-rail.mjs
```

Le volume monté sur `/data` (`DATA_DIR`) est le cache disque des graphes ferroviaires et des shapes. 
Sans lui, le graphe est retéléchargé et les shapes recalculées à chaque démarrage du conteneur.

## Références
- https://raildata.org.uk/dataProduct/P-9ca6bc7e-62e1-44d6-b93a-1616f7d2caf8/overview (Darwin Timetable Files)
- https://raildata.org.uk/dataProduct/P-3f10bf96-d8e8-4041-aa5e-d75d82c45c4e/overview (Darwin Real Time Train Information)
- https://wiki.openraildata.com/index.php/Darwin:Push_Port
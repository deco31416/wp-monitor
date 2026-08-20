# Diagrama 11: Modelo de Datos MongoDB

## Proposito

Visualizar relaciones logicas. MongoDB no aplica claves foraneas; la aplicacion conserva coherencia mediante `caseId`, `jid`, `callId`, `token` y enlaces de evidencia.

```mermaid
erDiagram
    OPERATOR_USER {
      string id PK
      string username
      string normalizedUsername UK
      string passwordHash
      number credentialVersion
      date credentialsUpdatedAt
    }
    CASE_RECORD ||--o{ AUDIT_EVENT : caseId
    CASE_RECORD ||--o{ EVIDENCE_LINK : caseId
    CASE_RECORD ||--o{ CHECK_IN : caseId
    CASE_RECORD ||--o{ CALL_ANALYSIS : caseId
    CASE_RECORD ||--o{ TRACKING_SESSION : caseId
    TRACKING_SESSION ||--o{ MEASUREMENT : trackingSessionId
    TRACKING_SESSION ||--o{ ACTIVITY_EVENT : trackingSessionId
    CONTACT ||--o{ TRACKING_SESSION : jid
    CONTACT ||--o{ MEASUREMENT : jid
    CONTACT ||--o{ ACTIVITY_EVENT : jid
    CONTACT ||--o{ CALL_ANALYSIS : targetJid
    CALL_ANALYSIS ||--o{ EVIDENCE_LINK : callId
    CHECK_IN ||--o| EVIDENCE_LINK : token

    CASE_RECORD {
      string caseId PK
      string status
      string primaryOperator
      string authorizationNote
      date createdAt
      date updatedAt
    }
    CONTACT {
      string jid PK
      string number
      string customName
      date addedAt
      boolean isActive
    }
    TRACKING_SESSION {
      string trackingSessionId PK
      string caseId
      string jid
      string operatorName
      string status
      date startedAt
      date stoppedAt
    }
    MEASUREMENT {
      string caseId
      string trackingSessionId
      string jid
      number rtt
      string state
      date timestamp
    }
    ACTIVITY_EVENT {
      string caseId
      string trackingSessionId
      string jid
      string source
      string type
      date timestamp
    }
    CALL_ANALYSIS {
      string callId
      string caseId
      string targetJid
      date startTime
      string verdict
    }
    CHECK_IN {
      string token PK
      string caseId
      string status
      date expiresAt
      string evidenceHash
    }
    AUDIT_EVENT {
      string caseId
      string action
      string scope
      string operatorName
      date timestamp
    }
    EVIDENCE_LINK {
      string caseId
      string type
      string refId
      date updatedAt
    }
```

## Retencion

Mediciones tienen TTL de 30 dias; actividad y analisis de llamada, 90 dias. Operador, casos, sesiones de tracking, auditoria, contactos, enlaces y Check-Ins requieren politica explicita de retencion. Solo existe `primary-operator`; `normalizedUsername` tambien es unico y `passwordHash` nunca contiene texto plano. Los documentos historicos previos al modelo por caso pueden no contener `caseId` o `trackingSessionId` y se excluyen de evidencia por caso.

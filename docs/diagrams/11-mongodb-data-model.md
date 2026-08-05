# Diagrama 11: Modelo de Datos MongoDB

## Proposito

Visualizar relaciones logicas. MongoDB no aplica claves foraneas; la aplicacion conserva coherencia mediante `caseId`, `jid`, `callId`, `token` y enlaces de evidencia.

```mermaid
erDiagram
    CASE_RECORD ||--o{ AUDIT_EVENT : caseId
    CASE_RECORD ||--o{ EVIDENCE_LINK : caseId
    CASE_RECORD ||--o{ CHECK_IN : caseId
    CASE_RECORD ||--o{ CALL_ANALYSIS : caseId
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
      date trackingStartedAt
    }
    MEASUREMENT {
      string jid
      number rtt
      string status
      date timestamp
    }
    ACTIVITY_EVENT {
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

Mediciones tienen TTL de 30 dias; actividad y analisis de llamada, 90 dias. Casos, auditoria, contactos, enlaces y Check-Ins requieren politica explicita de retencion.
